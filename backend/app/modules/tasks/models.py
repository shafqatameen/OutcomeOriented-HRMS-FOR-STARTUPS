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
    # The domain axis (see app.modules.org.models). Nullable because category
    # already carries the track axis and pricing on its own: a task with no
    # function is still a complete, completable, scorable task - it just lands
    # in the panel's Unassigned bucket instead of under a pillar.
    function_id = Column(Integer, ForeignKey("functions.id"), nullable=True, index=True)
    is_recurring = Column(Boolean, default=False)
    status = Column(String, default="Pending")
    points = Column(Integer, nullable=True)
    # Manual sort order for drag-and-drop. Global across tasks; a reorder only
    # rewrites the slots already held by the tasks in the request.
    position = Column(Integer, nullable=False, server_default="0", index=True)

    user = relationship("app.modules.users.models.User", back_populates="tasks")
    category = relationship("app.modules.tasks.models.Category", back_populates="tasks")
    milestone = relationship("app.modules.goals.models.Milestone", back_populates="tasks")
    function = relationship("app.modules.org.models.Function", back_populates="tasks")
    ledger_entries = relationship("app.modules.tasks.models.PointLedger", back_populates="task")

class PointLedger(Base):
    __tablename__ = "point_ledger"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    points_awarded = Column(Integer)
    #: How long the work actually took, captured at completion.
    #:
    #: Points gamify; minutes diagnose - and the two disagree on purpose. The
    #: Drain track is worth zero points, so in a points-only mix the hours lost
    #: to it render as 0% and vanish from the very view built to expose them.
    #: Nullable because every row written before this column existed has no
    #: honest value to backfill, and a guess would be worse than a gap.
    minutes = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=get_ist_now)

    user = relationship("app.modules.users.models.User", back_populates="ledger_entries")
    task = relationship("app.modules.tasks.models.Task", back_populates="ledger_entries")
