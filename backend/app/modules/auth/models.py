"""One-time links: email verification, and password reset.

One table for both, distinguished by `purpose`, because they are the same object
with different lifetimes - a high-entropy secret mailed to an address, good once,
for a while. Two tables would be the same columns twice and one more place to
forget to expire something.

The value stored is a SHA-256 digest, never the token itself. A database file
that leaks - a stray backup in backend/, of which this project has several - must
not hand over working password-reset links for every pending account in it.

SHA-256 rather than bcrypt is deliberate and is not the usual password advice.
Bcrypt is slow because human-chosen passwords are guessable, and the cost is what
makes guessing expensive. These tokens are 32 bytes from `secrets.token_urlsafe`,
so there is no guessing to price: a fast digest of an unguessable value is
already unattackable, and paying bcrypt's cost on every lookup would buy nothing.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.core.base import Base
from app.modules.tasks.models import get_ist_now


#: What a token is for. Kept as plain strings rather than an Enum column: SQLite
#: stores an Enum as a CHECK-constrained VARCHAR anyway, and adding a purpose
#: later would then mean rebuilding the table.
PURPOSE_VERIFY_EMAIL = "verify_email"
PURPOSE_PASSWORD_RESET = "password_reset"
PURPOSES = {PURPOSE_VERIFY_EMAIL, PURPOSE_PASSWORD_RESET}


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    #: One of PURPOSES. A verification token must not be usable as a reset
    #: token, so the purpose is part of every lookup rather than a label.
    purpose = Column(String, nullable=False, index=True)

    #: sha256(raw token), hex. Indexed because it is the only way a row is ever
    #: found - the raw token exists in exactly one place, the recipient's inbox.
    token_hash = Column(String, nullable=False, unique=True, index=True)

    expires_at = Column(DateTime, nullable=False)

    #: Stamped in the same transaction as whatever the token authorised, so a
    #: link cannot be replayed - not even by the mail scanner that opened it
    #: first, and not by anyone reading the recipient's inbox afterwards.
    used_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=get_ist_now, nullable=False)

    user = relationship("app.modules.users.models.User")
