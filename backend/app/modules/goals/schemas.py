from pydantic import BaseModel
from typing import List, Literal

class GoalBase(BaseModel):
    title: str

class GoalCreate(GoalBase):
    pass

class MilestoneBase(BaseModel):
    title: str
    goal_id: int

class MilestoneCreate(MilestoneBase):
    pass

class MilestoneUpdate(BaseModel):
    status: Literal["Completed"]

class TaskSummary(BaseModel):
    id: int
    title: str
    status: str
    user_id: int
    class Config:
        from_attributes = True

class Milestone(MilestoneBase):
    id: int
    status: str
    task_count: int
    completed_task_count: int
    progress_pct: float
    tasks: List[TaskSummary] = []
    class Config:
        from_attributes = True

class Goal(GoalBase):
    id: int
    milestone_count: int
    completed_milestone_count: int
    progress_pct: float
    milestones: List[Milestone] = []
    class Config:
        from_attributes = True
