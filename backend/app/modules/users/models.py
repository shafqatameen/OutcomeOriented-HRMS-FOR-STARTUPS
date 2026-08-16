from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    #: The sign-in identifier, and where this account's mail goes.
    #:
    #: Nullable because migration c2f8b1d40a37 could not invent one for the
    #: accounts that predate it. An account still sitting at null signs in by
    #: name instead (see modules/auth/router.py); setting an address here is
    #: what ends that fallback for that account.
    #:
    #: Stored already lowercased and stripped - normalise_email owns that, so a
    #: unique index is enough to stop Sam@x.com and sam@x.com both existing.
    email = Column(String, unique=True, index=True, nullable=True)
    role = Column(String, default="Member") # Admin vs Member
    total_points = Column(Integer, default=0)
    password_hash = Column(String, nullable=True)
    #: Deactivation is a sign-in block, not a hide: the account keeps its tasks,
    #: its ledger rows and its leaderboard position. Existing sessions stop
    #: working too, because get_current_user re-reads this on every request.
    is_active = Column(Boolean, nullable=False, server_default="1", default=True)
    #: The fixed place - the function this person is meant to be working in.
    #:
    #: Everyone gets one, not just the founder: the whole framing is that each
    #: person is CEO of their own life. It is a statement of intent, never a
    #: restriction - work logged outside the seat still counts fully, it just
    #: shows up on the panel as drift, which is the number worth looking at.
    home_function_id = Column(Integer, ForeignKey("functions.id"), nullable=True, index=True)

    tasks = relationship("app.modules.tasks.models.Task", back_populates="user")
    home_function = relationship(
        "app.modules.org.models.Function", back_populates="seated_users"
    )
    ledger_entries = relationship("app.modules.tasks.models.PointLedger", back_populates="user")
    permissions = relationship(
        "app.modules.users.models.UserPermission",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserPermission(Base):
    """One granted feature key for one account.

    Absence of a row means no access. Admins bypass these checks entirely, so
    their rows are informational only.
    """
    __tablename__ = "user_permissions"
    __table_args__ = (
        UniqueConstraint("user_id", "permission_key", name="uq_user_permission"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    permission_key = Column(String, nullable=False, index=True)

    user = relationship("app.modules.users.models.User", back_populates="permissions")
