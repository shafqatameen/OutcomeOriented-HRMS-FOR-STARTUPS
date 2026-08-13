from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    role = Column(String, default="Member") # Admin vs Member
    total_points = Column(Integer, default=0)
    password_hash = Column(String, nullable=True)
    #: Deactivation is a login block, not a hide: the account keeps its tasks,
    #: its ledger rows and its leaderboard position. Existing sessions stop
    #: working too, because get_current_user re-reads this on every request.
    is_active = Column(Boolean, nullable=False, server_default="1", default=True)

    tasks = relationship("app.modules.tasks.models.Task", back_populates="user")
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
