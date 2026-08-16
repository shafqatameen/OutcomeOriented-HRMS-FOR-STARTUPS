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
    #: The track axis: what this work does for you, and what it is worth.
    category_id: int
    #: The domain axis: what kind of work it is. Optional, because a task is
    #: complete and scorable without it - it just lands in the panel's
    #: Unassigned bucket. See app.modules.org.models.
    function_id: Optional[int] = None
    milestone_id: Optional[int] = None
    is_recurring: bool = False
    points: Optional[int] = None

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    """A partial edit of one task: send only the fields that should change.

    An explicit null is meaningful on the two nullable fields - it is how a
    pinned point value is released back to the category default, and how a task
    is unlinked from its milestone. Omission has to mean something different
    from null for that to work, which is why the router reads
    `model_fields_set` rather than testing each value for None.

    Category is absent on purpose: moving a task between columns is
    PATCH /tasks/{id}/move, which also places it in the destination's order.
    """
    title: Optional[str] = None
    user_id: Optional[int] = None
    milestone_id: Optional[int] = None
    #: Retagging is allowed even once the task is completed, unlike reassigning
    #: or repricing. The ledger stores neither the function nor the pillar - the
    #: panel resolves them through the task at read time - so this write moves
    #: the points with it instead of stranding them.
    function_id: Optional[int] = None
    is_recurring: Optional[bool] = None
    points: Optional[int] = None

class Task(TaskBase):
    id: int
    status: str
    position: int
    class Config:
        from_attributes = True

class TaskComplete(BaseModel):
    """Optional detail captured at the moment a task is marked done.

    `minutes` is what turns the panel from a scoreboard into a time audit: the
    Drain track is worth zero points, so hours lost to it are invisible in any
    points-only mix. Omitting it is always allowed - a missing number is honest,
    and a guessed one would quietly corrupt every share on the panel.
    """
    minutes: Optional[int] = None

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
