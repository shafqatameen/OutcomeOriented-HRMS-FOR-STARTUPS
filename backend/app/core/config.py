"""Loading backend/.env into the process environment.

Import this before anything that reads `os.environ` at import time - which is
most of core.mail, auth.security and calendar_sync.google - or those modules
capture their defaults before the file has been read and the settings appear to
have been ignored.

Why this exists at all: on the server the settings arrive as real environment
variables, from systemd's EnvironmentFile (/etc/hrms/backend.env, mode 640), and
nothing needs loading. Locally they live in backend/.env, and the documented run
command is a plain `uvicorn app.main:app --reload`, which reads no such file. So
every MAIL_* value could be correct on disk and still never reach the process -
the failure looks exactly like a wrong password, which is a bad hour to spend.

Deliberately hand-rolled rather than python-dotenv: the format below is the
subset this project's own .env.example uses, and the alternative is a dependency
whose entire job is thirty lines. It follows core.mail's stdlib-only reasoning.
"""
import os
from pathlib import Path

#: backend/, two levels up from app/core/.
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_FILE = BACKEND_DIR / ".env"


def _unquote(value: str) -> str:
    """Strips one matching pair of surrounding quotes, if present.

    Only a matching pair, so a password that legitimately starts with a quote is
    left alone. Inner quotes are never touched - a value like `Ki"ng@123` is that
    string exactly.
    """
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def load_env(path: Path = ENV_FILE) -> int:
    """Fills gaps in os.environ from `path`. Returns how many keys it set.

    Existing environment variables always win. That ordering is what makes this
    safe to leave enabled in production: systemd has already exported the real
    settings by the time this runs, and a stale .env that happened to be shipped
    inside the release tarball cannot quietly override them.

    A missing file is not an error - it is the normal state of a deployment.
    """
    if not path.is_file():
        return 0

    loaded = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        # `export FOO=bar` is accepted because people paste it out of shell
        # notes, and silently treating the key as "export FOO" would be worse
        # than either supporting it or rejecting it loudly.
        if line.startswith("export "):
            line = line[len("export "):].lstrip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = _unquote(value.strip())
        loaded += 1

    return loaded


#: Runs on import, so `from app.core import config` is the whole usage.
LOADED_KEYS = load_env()
