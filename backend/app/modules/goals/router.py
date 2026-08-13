from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.integrity import Blocker, deletion_blocked
from app.modules.goals import models, schemas
from app.modules.auth.dependencies import require_permission

router = APIRouter(tags=["Goals"])


def _clean_title(title: str) -> str:
    """Titles are trimmed, and a blank one is refused rather than stored."""
    cleaned = title.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Title must not be empty")
    return cleaned


def _milestone_task_counts(milestone: models.Milestone) -> tuple:
    """(total, completed) tasks hanging off this milestone."""
    total = len(milestone.tasks)
    completed = sum(1 for t in milestone.tasks if t.status == "Completed")
    return total, completed


def _serialize_milestone(m: models.Milestone) -> dict:
    task_count = len(m.tasks)
    completed_task_count = sum(1 for t in m.tasks if t.status == "Completed")
    natural_pct = round(100 * completed_task_count / task_count, 1) if task_count > 0 else 0.0
    # Explicit admin override forces 100.0 regardless of task state (covers zero-task
    # and force-early-complete cases). When status is still "Pending" but all linked
    # tasks are already Completed, natural_pct is already 100.0 on its own — no special
    # casing needed, and no write-back to the stored status column ever happens here.
    progress_pct = 100.0 if m.status == "Completed" else natural_pct
    return {
        "id": m.id,
        "title": m.title,
        "goal_id": m.goal_id,
        "status": m.status,
        "task_count": task_count,
        "completed_task_count": completed_task_count,
        "progress_pct": progress_pct,
        "tasks": [
            {"id": t.id, "title": t.title, "status": t.status, "user_id": t.user_id}
            for t in m.tasks
        ],
    }


def _serialize_goal(g: models.Goal) -> dict:
    milestones = [_serialize_milestone(m) for m in g.milestones]
    milestone_count = len(milestones)
    completed_milestone_count = sum(1 for m in milestones if m["progress_pct"] == 100.0)
    progress_pct = round(100 * completed_milestone_count / milestone_count, 1) if milestone_count > 0 else 0.0
    return {
        "id": g.id,
        "title": g.title,
        "milestone_count": milestone_count,
        "completed_milestone_count": completed_milestone_count,
        "progress_pct": progress_pct,
        "milestones": milestones,
    }


@router.get("/goals", response_model=List[schemas.Goal])
def read_goals(db: Session = Depends(get_db), _user=Depends(require_permission("goals.view"))):
    return [_serialize_goal(g) for g in db.query(models.Goal).all()]


@router.post("/goals", response_model=schemas.Goal)
def create_goal(goal: schemas.GoalCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    db_goal = models.Goal(**goal.dict())
    db.add(db_goal)
    db.commit()
    db.refresh(db_goal)
    return _serialize_goal(db_goal)


@router.patch("/goals/{goal_id}", response_model=schemas.Goal)
def update_goal(goal_id: int, update: schemas.GoalUpdate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    db_goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not db_goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db_goal.title = _clean_title(update.title)
    db.commit()
    db.refresh(db_goal)
    return _serialize_goal(db_goal)


@router.get("/goals/{goal_id}/usage", response_model=schemas.GoalUsage)
def read_goal_usage(goal_id: int, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    """What deleting this goal would have to take with it.

    Exists so the confirmation dialog can state the consequence before asking.
    Counts are read here rather than client-side because the task totals live
    behind `tasks.view`, which an account granted only `admin.goals` lacks.
    """
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    task_count = 0
    completed_task_count = 0
    for milestone in goal.milestones:
        total, completed = _milestone_task_counts(milestone)
        task_count += total
        completed_task_count += completed

    return {
        "goal_id": goal.id,
        "title": goal.title,
        "milestone_count": len(goal.milestones),
        "completed_milestone_count": sum(1 for m in goal.milestones if m.status == "Completed"),
        "task_count": task_count,
        "completed_task_count": completed_task_count,
    }


@router.delete("/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    cascade: bool = Query(
        False,
        description="Also delete this goal's milestones. Required while it still has any.",
    ),
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.goals")),
):
    """Deletes a goal, and its milestones when asked to.

    Refuses with 409 while milestones still belong to it, so the blast radius is
    stated before it happens rather than discovered afterwards.

    Tasks are never deleted here. A task's `milestone_id` is nullable and carries
    no points meaning — unlike `category_id`, which drives `effective_points` —
    so the tasks under a cascaded milestone are simply unlinked. They keep their
    category, their points and their ledger rows, and the leaderboard does not
    move.
    """
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    milestones = list(goal.milestones)

    if milestones and not cascade:
        completed = sum(1 for m in milestones if m.status == "Completed")
        blockers = [
            Blocker("milestones", len(milestones), f"{completed} completed, {len(milestones) - completed} pending")
        ]
        task_total = sum(_milestone_task_counts(m)[0] for m in milestones)
        if task_total:
            blockers.append(Blocker("tasks", task_total, "kept and unlinked, not deleted"))
        raise deletion_blocked(
            entity="goal",
            name=goal.title,
            blockers=blockers,
            remedy="Confirm to delete the goal and its milestones.",
        )

    unlinked_tasks = 0
    for milestone in milestones:
        for task in milestone.tasks:
            task.milestone_id = None
            unlinked_tasks += 1
        db.delete(milestone)

    db.delete(goal)
    db.commit()

    return {
        "message": "Goal deleted",
        "goal_id": goal_id,
        "deleted_milestones": len(milestones),
        "unlinked_tasks": unlinked_tasks,
    }


@router.get("/milestones", response_model=List[schemas.Milestone])
def read_milestones(db: Session = Depends(get_db), _user=Depends(require_permission("goals.view"))):
    return [_serialize_milestone(m) for m in db.query(models.Milestone).all()]


@router.post("/milestones", response_model=schemas.Milestone)
def create_milestone(milestone: schemas.MilestoneCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    goal = db.query(models.Goal).filter(models.Goal.id == milestone.goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db_milestone = models.Milestone(**milestone.dict())
    db.add(db_milestone)
    db.commit()
    db.refresh(db_milestone)
    return _serialize_milestone(db_milestone)


@router.patch("/milestones/{milestone_id}", response_model=schemas.Milestone)
def update_milestone(milestone_id: int, update: schemas.MilestoneUpdate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    """Renames a milestone, completes it, or both.

    The already-completed guard covers the status transition only — renaming a
    finished milestone stays allowed, since fixing a typo on it is not the thing
    that needed protecting.
    """
    db_milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
    if not db_milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    if update.title is None and update.status is None:
        raise HTTPException(status_code=400, detail="Provide a title or a status to update")

    # Validated up front so a rejected status leaves the title unwritten too.
    if update.status is not None and db_milestone.status == "Completed":
        raise HTTPException(status_code=400, detail="Milestone already completed")
    title = _clean_title(update.title) if update.title is not None else None

    if title is not None:
        db_milestone.title = title
    if update.status is not None:
        db_milestone.status = update.status

    db.commit()
    db.refresh(db_milestone)
    return _serialize_milestone(db_milestone)


@router.get("/milestones/{milestone_id}/usage", response_model=schemas.MilestoneUsage)
def read_milestone_usage(milestone_id: int, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    """What deleting this milestone would disturb, for the confirmation dialog."""
    milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")

    total, completed = _milestone_task_counts(milestone)
    return {
        "milestone_id": milestone.id,
        "title": milestone.title,
        "goal_id": milestone.goal_id,
        "goal_title": milestone.goal.title if milestone.goal else "",
        "task_count": total,
        "completed_task_count": completed,
        "pending_task_count": total - completed,
    }


@router.delete("/milestones/{milestone_id}")
def delete_milestone(
    milestone_id: int,
    cascade: bool = Query(
        False,
        description="Unlink this milestone's tasks first. Required while it still has any.",
    ),
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.goals")),
):
    """Deletes a milestone, unlinking its tasks when asked to.

    Refuses with 409 while tasks still point at it. `cascade` unlinks those tasks
    rather than deleting them — see `delete_goal` for why that is safe — leaving
    them exactly as they were minus the milestone association.
    """
    milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")

    tasks = list(milestone.tasks)

    if tasks and not cascade:
        completed = sum(1 for t in tasks if t.status == "Completed")
        raise deletion_blocked(
            entity="milestone",
            name=milestone.title,
            blockers=[
                Blocker("tasks", len(tasks), f"{completed} completed, {len(tasks) - completed} pending")
            ],
            remedy="Confirm to delete it; the tasks are kept and simply unlinked.",
        )

    for task in tasks:
        task.milestone_id = None

    db.delete(milestone)
    db.commit()

    return {
        "message": "Milestone deleted",
        "milestone_id": milestone_id,
        "unlinked_tasks": len(tasks),
    }
