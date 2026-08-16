"""Issuing and spending the one-time links.

Every rule about how a link behaves lives here rather than in the endpoints, so
that "can this token still be used?" has exactly one answer and adding a third
purpose later cannot accidentally get a weaker version of it.

The raw token exists in precisely two places and never a third: the URL in the
recipient's mail, and the return value of `issue` for as long as it takes to
build that URL. The database holds a digest. Nothing logs it.
"""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.modules.auth import models
from app.modules.tasks.models import get_ist_now

#: 32 bytes of entropy, URL-safe. Long enough that guessing is not a threat
#: model, short enough that the link survives an email client wrapping it.
TOKEN_BYTES = 32

#: A day to confirm an address: long enough to cover "I'll do it tonight", and
#: the account is inert until it is used, so a stale one costs nothing.
VERIFY_TTL = timedelta(hours=24)

#: An hour to reset a password. Deliberately much shorter than verification -
#: this link takes over an existing account, so the window in which a forwarded
#: or shoulder-read mail is dangerous should be small.
RESET_TTL = timedelta(hours=1)

TTL_BY_PURPOSE = {
    models.PURPOSE_VERIFY_EMAIL: VERIFY_TTL,
    models.PURPOSE_PASSWORD_RESET: RESET_TTL,
}


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue(db: Session, user_id: int, purpose: str, now: Optional[datetime] = None) -> str:
    """Creates a token for `user_id` and returns the raw value, once.

    Any earlier unused token of the same purpose for the same account is
    invalidated first. Two live reset links for one mailbox is one more chance
    for the wrong one to be used, and the person only ever means the newest -
    they clicked "send it again" because the first did not arrive.

    Does not commit: the caller decides what else belongs in the transaction,
    which for signup is the account row itself.
    """
    if purpose not in models.PURPOSES:
        raise ValueError(f"Unknown token purpose: {purpose}")

    at = now or get_ist_now()
    invalidate(db, user_id, purpose, at)

    raw = secrets.token_urlsafe(TOKEN_BYTES)
    db.add(
        models.AuthToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=_digest(raw),
            expires_at=at + TTL_BY_PURPOSE[purpose],
            created_at=at,
        )
    )
    return raw


def invalidate(
    db: Session, user_id: int, purpose: Optional[str] = None, now: Optional[datetime] = None
) -> int:
    """Marks this account's outstanding tokens spent. Returns how many.

    `purpose=None` means all of them, which is what a completed password reset
    wants: whoever just proved control of the mailbox should not leave a second
    live link behind for anyone who reads it later.
    """
    at = now or get_ist_now()
    query = (
        db.query(models.AuthToken)
        .filter(models.AuthToken.user_id == user_id)
        .filter(models.AuthToken.used_at.is_(None))
    )
    if purpose is not None:
        query = query.filter(models.AuthToken.purpose == purpose)

    return query.update({models.AuthToken.used_at: at}, synchronize_session=False)


def look_up(
    db: Session, raw: str, purpose: str, now: Optional[datetime] = None
) -> Optional[models.AuthToken]:
    """The live token matching `raw`, or None if there is no such usable link.

    None covers every failure the caller must not distinguish for the person
    holding the link - wrong, expired, already spent, or for a different purpose.
    They all mean "ask for a new one", and separating them only tells someone
    probing which of their guesses was closest.

    Read-only: spending the token is `consume`, so a page can check a link
    without burning it. That matters because mail scanners open links before
    people do.
    """
    if not raw or purpose not in models.PURPOSES:
        return None

    at = now or get_ist_now()
    return (
        db.query(models.AuthToken)
        .filter(models.AuthToken.token_hash == _digest(raw))
        .filter(models.AuthToken.purpose == purpose)
        .filter(models.AuthToken.used_at.is_(None))
        .filter(models.AuthToken.expires_at > at)
        .first()
    )


def consume(
    db: Session, raw: str, purpose: str, now: Optional[datetime] = None
) -> Optional[models.AuthToken]:
    """Looks the token up and stamps it spent, without committing.

    Not committing is the whole point. The caller writes the password in the
    same transaction, so the link is spent if and only if the thing it
    authorised actually happened - a commit failure cannot leave someone holding
    a dead link and an unchanged password.
    """
    at = now or get_ist_now()
    token = look_up(db, raw, purpose, at)
    if token is None:
        return None

    token.used_at = at
    return token
