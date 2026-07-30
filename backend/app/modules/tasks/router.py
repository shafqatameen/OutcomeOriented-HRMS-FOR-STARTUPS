from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.modules.tasks import models, schemas
from app.modules.tasks.points import effective_points, points_are_pinned
from app.modules.auth.dependencies import require_permission, require_user

router = APIRouter(tags=["Tasks"])

@router.get("/categories", response_model=List[schemas.Category])
def read_categories(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.Category).all()

@router.post("/categories", response_model=schemas.Category)
def create_category(category: schemas.CategoryCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.categories"))):
    db_cat = models.Category(**category.dict())
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat

@router.patch("/categories/{category_id}", response_model=schemas.Category)
def update_category(category_id: int, update: schemas.CategoryUpdate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.categories"))):
    db_cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if update.name is not None:
        db_cat.name = update.name
    if update.default_points is not None:
        db_cat.default_points = update.default_points
    db.commit()
    db.refresh(db_cat)
    return db_cat

@router.get("/tasks", response_model=List[schemas.Task])
def read_tasks(db: Session = Depends(get_db), _user=Depends(require_permission("tasks.view"))):
    return db.query(models.Task).order_by(models.Task.position, models.Task.id).all()

@router.post("/tasks", response_model=schemas.Task)
def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.tasks"))):
    next_position = (db.query(func.max(models.Task.position)).scalar() or 0) + 1
    db_task = models.Task(**task.dict(), position=next_position)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

def _load_ordered(db: Session, ids: list) -> list:
    """Validates an ordered id list and returns the matching Task rows."""
    if not ids:
        raise HTTPException(status_code=400, detail="task_ids must not be empty")
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="task_ids must not contain duplicates")

    tasks = db.query(models.Task).filter(models.Task.id.in_(ids)).all()
    if len(tasks) != len(ids):
        raise HTTPException(status_code=404, detail="One or more tasks not found")
    return tasks


def _apply_order(tasks: list, ids: list) -> None:
    """Rewrites only the position slots these tasks already hold, so tasks absent
    from the request keep the order they had."""
    slots = sorted(task.position for task in tasks)
    # Tied slots would let the id tiebreak in read_tasks override the requested
    # order, so force them strictly increasing before assigning.
    for i in range(1, len(slots)):
        if slots[i] <= slots[i - 1]:
            slots[i] = slots[i - 1] + 1

    by_id = {task.id: task for task in tasks}
    for slot, task_id in zip(slots, ids):
        by_id[task_id].position = slot


@router.patch("/tasks/reorder")
def reorder_tasks(payload: schemas.TaskReorder, db: Session = Depends(get_db), _user=Depends(require_permission("tasks.organize"))):
    """Applies a drag-and-drop reorder within one column."""
    ids = payload.task_ids
    tasks = _load_ordered(db, ids)
    _apply_order(tasks, ids)
    db.commit()
    return {"message": "Tasks reordered", "count": len(ids)}


@router.patch("/tasks/{task_id}/move")
def move_task(
    task_id: int,
    payload: schemas.TaskMove,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("tasks.organize")),
):
    """Moves a task into another category and reorders the destination column.

    Points are deliberately left untouched: a task with no explicit points keeps
    deriving them from its category, so the value follows the move, while a
    custom value set in Admin survives it.
    """
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "Completed":
        raise HTTPException(
            status_code=400,
            detail="Completed tasks cannot be moved - their points are already in the ledger",
        )

    category = db.query(models.Category).filter(models.Category.id == payload.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if task_id not in payload.task_ids:
        raise HTTPException(status_code=400, detail="task_ids must include the task being moved")

    tasks = _load_ordered(db, payload.task_ids)

    task.category_id = payload.category_id
    _apply_order(tasks, payload.task_ids)
    db.commit()

    return {
        "message": "Task moved",
        "task_id": task.id,
        "category_id": task.category_id,
        "points_are_pinned": points_are_pinned(task),
        "effective_points": effective_points(task, category),
    }

@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: int, db: Session = Depends(get_db), current_user=Depends(require_permission("tasks.complete"))):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status == "Completed":
        raise HTTPException(status_code=400, detail="Task already completed")
    if current_user.role != "Admin" and current_user.id != db_task.user_id:
        raise HTTPException(status_code=403, detail="You can only complete your own tasks")

    db_task.status = "Completed"

    points = effective_points(db_task)

    db_task.user.total_points += points

    ledger = models.PointLedger(
        user_id=db_task.user_id,
        task_id=db_task.id,
        points_awarded=points
    )
    db.add(ledger)
    db.commit()
    return {"message": "Task completed", "points_awarded": points}
