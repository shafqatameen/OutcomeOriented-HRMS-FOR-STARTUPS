from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from app.core.base import Base

class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    milestones = relationship("app.modules.goals.models.Milestone", back_populates="goal")

class Milestone(Base):
    __tablename__ = "milestones"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    goal_id = Column(Integer, ForeignKey("goals.id"))
    status = Column(String, default="Pending", nullable=False)
    goal = relationship("app.modules.goals.models.Goal", back_populates="milestones")
    tasks = relationship("app.modules.tasks.models.Task", back_populates="milestone")
