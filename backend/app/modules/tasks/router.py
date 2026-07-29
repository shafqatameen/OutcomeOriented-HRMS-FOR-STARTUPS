from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.modules.tasks import models, schemas
from app.modules.auth.dependencies import require_admin, require_user

router = APIRouter(tags=["Tasks"])

@router.get("/categories", response_model=List[schemas.Category])
def read_categories(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.Category).all()

@router.post("/categories", response_model=schemas.Category)
def create_category(category: schemas.CategoryCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    db_cat = models.Category(**category.dict())
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat

@router.patch("/categories/{category_id}", response_model=schemas.Category)
def update_category(category_id: int, update: schemas.CategoryUpdate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
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
def read_tasks(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.Task).all()

@router.post("/tasks", response_model=schemas.Task)
def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    db_task = models.Task(**task.dict())
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: int, db: Session = Depends(get_db), current_user=Depends(require_user)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status == "Completed":
        raise HTTPException(status_code=400, detail="Task already completed")
    if current_user.role != "Admin" and current_user.id != db_task.user_id:
        raise HTTPException(status_code=403, detail="You can only complete your own tasks")

    db_task.status = "Completed"
    
    # Points precedence: explicitly set on task > category default
    points = db_task.points if db_task.points is not None else db_task.category.default_points
    
    db_task.user.total_points += points

    ledger = models.PointLedger(
        user_id=db_task.user_id,
        task_id=db_task.id,
        points_awarded=points
    )
    db.add(ledger)
    db.commit()
    return {"message": "Task completed", "points_awarded": points}
