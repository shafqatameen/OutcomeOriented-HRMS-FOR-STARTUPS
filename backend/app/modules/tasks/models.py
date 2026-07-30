from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
import pytz
from app.core.base import Base

def get_ist_now():
    return datetime.now(pytz.timezone('Asia/Kolkata'))

class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    default_points = Column(Integer, default=1)
    tasks = relationship("app.modules.tasks.models.Task", back_populates="category")

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    category_id = Column(Integer, ForeignKey("categories.id"))
    milestone_id = Column(Integer, ForeignKey("milestones.id"), nullable=True)
    is_recurring = Column(Boolean, default=False)
    status = Column(String, default="Pending")
    points = Column(Integer, nullable=True)
    # Manual sort order for drag-and-drop. Global across tasks; a reorder only
    # rewrites the slots already held by the tasks in the request.
    position = Column(Integer, nullable=False, server_default="0", index=True)

    user = relationship("app.modules.users.models.User", back_populates="tasks")
    category = relationship("app.modules.tasks.models.Category", back_populates="tasks")
    milestone = relationship("app.modules.goals.models.Milestone", back_populates="tasks")
    ledger_entries = relationship("app.modules.tasks.models.PointLedger", back_populates="task")

class PointLedger(Base):
    __tablename__ = "point_ledger"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    points_awarded = Column(Integer)
    timestamp = Column(DateTime, default=get_ist_now)

    user = relationship("app.modules.users.models.User", back_populates="ledger_entries")
    task = relationship("app.modules.tasks.models.Task", back_populates="ledger_entries")
