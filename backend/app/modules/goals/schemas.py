from pydantic import BaseModel
from typing import List, Literal, Optional

class GoalBase(BaseModel):
    title: str

class GoalCreate(GoalBase):
    pass

class GoalUpdate(BaseModel):
    title: str

class MilestoneBase(BaseModel):
    title: str
    goal_id: int

class MilestoneCreate(MilestoneBase):
    pass

class MilestoneUpdate(BaseModel):
    """A rename, a completion, or both.

    Both fields are optional so the existing `{"status": "Completed"}` callers
    keep working unchanged; sending neither is refused rather than treated as a
    no-op write.
    """
    title: Optional[str] = None
    status: Optional[Literal["Completed"]] = None

class GoalUsage(BaseModel):
    """What deleting this goal would take with it, asked before confirming."""
    goal_id: int
    title: str
    milestone_count: int
    completed_milestone_count: int
    task_count: int
    completed_task_count: int

class MilestoneUsage(BaseModel):
    """What deleting this milestone would disturb, asked before confirming."""
    milestone_id: int
    title: str
    goal_id: int
    goal_title: str
    task_count: int
    completed_task_count: int
    pending_task_count: int

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
