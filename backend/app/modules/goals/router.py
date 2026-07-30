from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.modules.goals import models, schemas
from app.modules.auth.dependencies import require_permission

router = APIRouter(tags=["Goals"])


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
def update_milestone_status(milestone_id: int, update: schemas.MilestoneUpdate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.goals"))):
    db_milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
    if not db_milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    if db_milestone.status == "Completed":
        raise HTTPException(status_code=400, detail="Milestone already completed")
    db_milestone.status = update.status
    db.commit()
    db.refresh(db_milestone)
    return _serialize_milestone(db_milestone)
