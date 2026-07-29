from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.modules.users import models, schemas
from app.modules.auth.dependencies import require_admin, require_user
from app.modules.auth.security import hash_password

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("", response_model=List[schemas.User])
def read_users(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.User).all()

@router.post("", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    db_user = models.User(
        name=user.name,
        role=user.role,
        password_hash=hash_password(user.password),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
