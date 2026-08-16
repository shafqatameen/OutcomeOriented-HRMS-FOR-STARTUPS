"""A speed bump on the unauthenticated endpoints.

Worth being blunt about what this is not. It is an in-process dict of
timestamps: it resets when the API restarts, it counts separately in every
worker, and anyone with a handful of IP addresses walks around it. It is not a
defence against a determined attacker and must never be the only thing standing
between the internet and something expensive.

What it does buy is real anyway. `/auth/forgot-password` sends mail on request,
so without a limit one script can empty a mailbox's daily sending quota - taking
password resets down for everybody - or bury one person under a thousand
messages. Bounding that to a few per minute costs nothing and removes the easy
version of both.

The project runs a single uvicorn process, so "per worker" is currently "per
server". If that ever changes, this needs to become Redis-backed rather than
quietly getting weaker, which is why the limitation is written here.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

#: Guards the buckets below. FastAPI serves sync endpoints from a thread pool,
#: so two requests really can touch the same key at once.
_lock = threading.Lock()
_hits: Dict[str, Deque[float]] = defaultdict(deque)

#: Above this many distinct keys the whole table is dropped rather than grown.
#: An unbounded dict keyed partly on caller-supplied addresses is a slow memory
#: leak with a stranger holding the tap; losing the counts is the cheap failure.
MAX_KEYS = 10_000


def _prune(bucket: Deque[float], cutoff: float) -> None:
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()


def check(key: str, limit: int, per_seconds: float) -> bool:
    """Records a hit against `key`. True if it is within the limit.

    A sliding window rather than a fixed one: fixed windows let twice the limit
    through across a boundary, which for mail sending is the difference between
    "five messages a minute" and "ten in two seconds, twice a minute".
    """
    now = time.monotonic()
    cutoff = now - per_seconds

    with _lock:
        if len(_hits) > MAX_KEYS:
            _hits.clear()

        bucket = _hits[key]
        _prune(bucket, cutoff)

        if len(bucket) >= limit:
            return False

        bucket.append(now)
        return True


def reset() -> None:
    """Clears every counter. For tests, so one case cannot fail the next."""
    with _lock:
        _hits.clear()
