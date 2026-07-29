from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from app.core.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    role = Column(String, default="Member") # Admin vs Member
    total_points = Column(Integer, default=0)
    password_hash = Column(String, nullable=True)

    tasks = relationship("app.modules.tasks.models.Task", back_populates="user")
    ledger_entries = relationship("app.modules.tasks.models.PointLedger", back_populates="user")
