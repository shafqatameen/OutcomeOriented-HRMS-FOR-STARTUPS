from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class CategoryBase(BaseModel):
    name: str
    default_points: int

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    default_points: Optional[int] = None

class Category(CategoryBase):
    id: int
    class Config:
        from_attributes = True

class CategoryUsage(BaseModel):
    """What a category delete would have to deal with, asked before confirming."""
    category_id: int
    name: str
    task_count: int
    completed_task_count: int
    pending_task_count: int

class TaskBase(BaseModel):
    title: str
    user_id: int
    category_id: int
    milestone_id: Optional[int] = None
    is_recurring: bool = False
    points: Optional[int] = None

class TaskCreate(TaskBase):
    pass

class Task(TaskBase):
    id: int
    status: str
    position: int
    class Config:
        from_attributes = True

class TaskReorder(BaseModel):
    """Full ordered id list for ONE column, from top to bottom."""
    task_ids: List[int]

class TaskMove(BaseModel):
    """Moves a task into another category and reorders the destination column.

    task_ids is the destination column's full order after the move, top to
    bottom, and must contain the moved task.
    """
    category_id: int
    task_ids: List[int]

class PointLedgerBase(BaseModel):
    user_id: int
    task_id: Optional[int] = None
    points_awarded: int

class PointLedger(PointLedgerBase):
    id: int
    timestamp: datetime
    class Config:
        from_attributes = True
