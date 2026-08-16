"""Encryption for third-party credentials held on this account's behalf.

A Google refresh token is not a password hash. A hash proves somebody knew a
secret; a refresh token *is* the secret, and it stays usable until it is revoked
— anyone holding one can read and rewrite the calendar it belongs to, for as
long as they like, without the account owner seeing a sign-in. That is why these
columns are ciphertext where `users.password_hash` is a hash: there is nothing
to compare against, only something to use, so the only protection available is
that a stolen copy is unreadable.

"A stolen copy" is not hypothetical here. The database is a single SQLite file,
and the backend directory already holds half a dozen `pointsystem.backup-*.db`
snapshots taken before past migrations. Those are the realistic disclosure — a
file copied for safety, kept, and forgotten — and encrypting the token columns is
what keeps such a copy from being a live grant on somebody's calendar.

The key is derived from JWT_SECRET_KEY rather than configured separately, so
there is exactly one secret to deploy and no way to run with sessions signed and
tokens in the clear. The consequence is worth stating plainly: rotating
JWT_SECRET_KEY makes existing tokens undecryptable. That is handled rather than
prevented — `decrypt` returns None, the integration reports itself disconnected,
and the owner reconnects with two clicks. Rotating a signing key already logs
everybody out; this is the same event, and failing closed on a key change is the
correct behaviour for a store of other people's credentials.
"""
import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.modules.auth.security import SECRET_KEY

#: Domain separation. The session signer and this cipher must never derive the
#: same bytes from the same secret, or a token becomes a forgeable session.
_KEY_PURPOSE = b"outcomeoriented:oauth-token-encryption:v1"


def _fernet() -> Fernet:
    digest = hashlib.sha256(_KEY_PURPOSE + SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: Optional[str]) -> Optional[str]:
    """Ciphertext for storage. None passes through — an absent token is a state."""
    if value is None:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: Optional[str]) -> Optional[str]:
    """The plaintext, or None if this row cannot be read with the current key.

    None rather than an exception because every caller's answer to both cases is
    the same — treat the account as not connected — and because a raise here
    would take down a status read that is only trying to say "reconnect".
    """
    if value is None:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return None
