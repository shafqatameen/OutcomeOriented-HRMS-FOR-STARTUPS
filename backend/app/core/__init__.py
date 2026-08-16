"""Package init whose only job is to load backend/.env before anything reads it.

This exists here, rather than as a line at the top of each entry point, because
"remember to import config first" is a rule that gets forgotten - and when it is
forgotten the symptom is not an error but a silent fallback: an insecure default
JWT secret, or mail reporting itself unconfigured while the settings sit
correctly on disk a directory away.

Every module in this backend reaches `app.core` for the session, the Base or the
mailer, so importing it is not a discipline anyone has to keep. Loading here
makes the settings arrive by construction.

See config.py for why existing environment variables always win, which is what
keeps this safe under systemd in production.
"""
from app.core import config  # noqa: F401
