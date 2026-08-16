from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
from app.core.database import get_db
from app.core.integrity import Blocker, deletion_blocked
from app.modules.tasks import models, schemas
from app.modules.tasks.points import effective_points, points_are_pinned
from app.modules.goals import models as goal_models
from app.modules.users import models as user_models
from app.modules.org import models as org_models
from app.modules.auth.dependencies import require_permission, require_user

router = APIRouter(tags=["Tasks"])


def _require_function(db: Session, function_id: int) -> None:
    """Refuses a function tag that does not resolve.

    SQLite is running without `PRAGMA foreign_keys` (see core.database), so an
    unchecked id would be accepted and the task would simply stop appearing under
    any pillar on the panel - a silent loss rather than a visible error.
    """
    exists = (
        db.query(org_models.Function.id)
        .filter(org_models.Function.id == function_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Function not found")

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

def _category_usage(db: Session, category_id: int) -> Tuple[int, int]:
    """(total, completed) tasks pointing at this category."""
    total = 0
    completed = 0
    for status, count in (
        db.query(models.Task.status, func.count(models.Task.id))
        .filter(models.Task.category_id == category_id)
        .group_by(models.Task.status)
        .all()
    ):
        total += count
        if status == "Completed":
            completed += count
    return total, completed

@router.get("/categories/{category_id}/usage", response_model=schemas.CategoryUsage)
def read_category_usage(category_id: int, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.categories"))):
    """What deleting this category would have to deal with.

    Exists so the confirmation dialog can state the consequence before asking,
    rather than the user discovering it from a rejected delete. Counts are read
    here instead of client-side because /tasks needs `tasks.view`, which an
    account granted only `admin.categories` does not have.
    """
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    total, completed = _category_usage(db, category_id)
    return {
        "category_id": category.id,
        "name": category.name,
        "task_count": total,
        "completed_task_count": completed,
        "pending_task_count": total - completed,
    }

@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    reassign_to: Optional[int] = Query(
        None,
        description="Move every task in this category here first. Required while the category is still in use.",
    ),
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.categories")),
):
    """Deletes a category, moving its tasks elsewhere first when asked to.

    Refuses with 409 while tasks still point at it. Clearing `category_id`
    instead would be worse than it looks: `effective_points` falls back to 0
    without a category, and the board's Uncategorized column refuses drops, so
    those tasks would be stranded there at zero with no way back.

    Reassignment carries the same points caveat as PATCH /tasks/{id}/move - a
    task with no pinned value inherits the destination's default. For completed
    tasks it also shifts their ledger points into the destination's column on the
    leaderboard, because the ledger derives its category through the task rather
    than storing one.
    """
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    tasks = db.query(models.Task).filter(models.Task.category_id == category_id).all()

    if tasks and reassign_to is None:
        completed = sum(1 for task in tasks if task.status == "Completed")
        raise deletion_blocked(
            entity="category",
            name=category.name,
            blockers=[
                Blocker("tasks", len(tasks), f"{completed} completed, {len(tasks) - completed} pending")
            ],
            remedy="Pick another category to move them to, then delete.",
        )

    if reassign_to is not None:
        if reassign_to == category_id:
            raise HTTPException(status_code=400, detail="reassign_to must be a different category")
        target = db.query(models.Category).filter(models.Category.id == reassign_to).first()
        if not target:
            raise HTTPException(status_code=404, detail="Destination category not found")
        for task in tasks:
            task.category_id = reassign_to

    db.delete(category)
    db.commit()

    return {
        "message": "Category deleted",
        "category_id": category_id,
        "reassigned_tasks": len(tasks) if reassign_to is not None else 0,
        "reassigned_to": reassign_to,
    }

@router.get("/tasks", response_model=List[schemas.Task])
def read_tasks(db: Session = Depends(get_db), _user=Depends(require_permission("tasks.view"))):
    return db.query(models.Task).order_by(models.Task.position, models.Task.id).all()

@router.post("/tasks", response_model=schemas.Task)
def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.tasks"))):
    if task.function_id is not None:
        _require_function(db, task.function_id)

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
def complete_task(
    task_id: int,
    payload: Optional[schemas.TaskComplete] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("tasks.complete")),
):
    """Marks a task done and appends to the ledger.

    The body is optional so every existing caller that posts nothing keeps
    working unchanged; sending `minutes` records how long the work took, which
    is what lets the panel report a share of *time* rather than only of points.
    """
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status == "Completed":
        raise HTTPException(status_code=400, detail="Task already completed")
    if current_user.role != "Admin" and current_user.id != db_task.user_id:
        raise HTTPException(status_code=403, detail="You can only complete your own tasks")

    minutes = payload.minutes if payload else None
    if minutes is not None and minutes < 0:
        raise HTTPException(status_code=400, detail="Minutes must not be negative")

    db_task.status = "Completed"

    points = effective_points(db_task)

    db_task.user.total_points += points

    ledger = models.PointLedger(
        user_id=db_task.user_id,
        task_id=db_task.id,
        points_awarded=points,
        minutes=minutes,
    )
    db.add(ledger)
    db.commit()
    return {"message": "Task completed", "points_awarded": points, "minutes": minutes}


# Declared after PATCH /tasks/reorder on purpose: FastAPI matches routes in
# declaration order, and "reorder" would otherwise be swallowed by {task_id}.
@router.patch("/tasks/{task_id}", response_model=schemas.Task)
def update_task(
    task_id: int,
    update: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.tasks")),
):
    """Edits one task in place: retitle it, reassign it, repoint it, relink it.

    Only the fields actually present in the body are written, so a dialog that
    submits a new title cannot blank the assignee by omission.

    Reassigning or repricing a completed task is refused. Its points are already
    in the ledger, under the person who earned them and at the value awarded;
    neither write would move the ledger with it, so the leaderboard would start
    disagreeing with the task it was computed from.
    """
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    sent = update.model_fields_set
    if not sent:
        raise HTTPException(status_code=400, detail="Provide at least one field to update")

    if task.status == "Completed" and ({"user_id", "points"} & sent):
        raise HTTPException(
            status_code=400,
            detail="Completed tasks cannot be reassigned or repriced - their points are already in the ledger",
        )

    # Everything is validated before anything is written, so a rejected field
    # cannot leave an earlier one half-applied.
    if "title" in sent:
        title = (update.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title must not be empty")

    if "user_id" in sent:
        if update.user_id is None:
            raise HTTPException(status_code=400, detail="A task must stay assigned to someone")
        assignee = (
            db.query(user_models.User).filter(user_models.User.id == update.user_id).first()
        )
        if not assignee:
            raise HTTPException(status_code=404, detail="User not found")
        # A deactivated account cannot sign in, so it could never complete what
        # it was handed - the task would sit on the board unfinishable.
        if not assignee.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"{assignee.name} is deactivated and cannot be assigned tasks",
            )

    if "milestone_id" in sent and update.milestone_id is not None:
        milestone = (
            db.query(goal_models.Milestone)
            .filter(goal_models.Milestone.id == update.milestone_id)
            .first()
        )
        if not milestone:
            raise HTTPException(status_code=404, detail="Milestone not found")

    if "function_id" in sent and update.function_id is not None:
        _require_function(db, update.function_id)

    if "points" in sent and update.points is not None and update.points < 0:
        raise HTTPException(status_code=400, detail="Points must not be negative")

    if "title" in sent:
        task.title = title
    if "user_id" in sent:
        task.user_id = update.user_id
    if "milestone_id" in sent:
        task.milestone_id = update.milestone_id
    # A null here untags the task, dropping it into the panel's Unassigned bucket.
    if "function_id" in sent:
        task.function_id = update.function_id
    if "is_recurring" in sent:
        task.is_recurring = bool(update.is_recurring)
    # A null here is a deliberate un-pin: the task goes back to inheriting its
    # category's default (see tasks.points).
    if "points" in sent:
        task.points = update.points

    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.tasks")),
):
    """Deletes a pending task. Refuses once its points have been awarded.

    SQLite is running without `PRAGMA foreign_keys` (see core.database), so
    deleting a completed task would not fail on its ledger rows - it would leave
    them pointing at nothing. The leaderboard's per-category totals join the
    ledger back through the task, so those points would quietly vanish from
    every category column while still counting in the all-time total, with no
    way to reconstruct which column they belonged to. Completed tasks are
    therefore refused with the same structured 409 the other deletes use.
    """
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ledger_count, awarded = (
        db.query(
            func.count(models.PointLedger.id),
            func.coalesce(func.sum(models.PointLedger.points_awarded), 0),
        )
        .filter(models.PointLedger.task_id == task_id)
        .one()
    )

    if task.status == "Completed" or ledger_count:
        blocker = (
            Blocker("point ledger entries", ledger_count, f"{awarded} points already awarded")
            if ledger_count
            else Blocker("completed tasks", 1, "already counted on the leaderboard")
        )
        raise deletion_blocked(
            entity="task",
            name=task.title,
            blockers=[blocker],
            remedy="Completed tasks are the record the leaderboard is built from, so they stay.",
        )

    db.delete(task)
    db.commit()

    return {"message": "Task deleted", "task_id": task_id}
