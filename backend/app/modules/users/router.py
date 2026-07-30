from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.modules.users import models, schemas
from app.modules.auth.dependencies import granted_keys, require_permission, require_user
from app.modules.auth.permissions import (
    DEFAULT_NEW_USER_PERMISSIONS,
    PERMISSIONS,
    unknown_keys,
)
from app.modules.auth.security import hash_password

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("", response_model=List[schemas.User])
def read_users(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.User).all()

@router.post("", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.users"))):
    if db.query(models.User).filter(models.User.name == user.name).first():
        raise HTTPException(status_code=400, detail="A user with that name already exists")

    db_user = models.User(
        name=user.name,
        role=user.role,
        password_hash=hash_password(user.password),
    )
    db.add(db_user)
    db.flush()

    # New accounts start with read access plus completing their own tasks.
    # Anything beyond that is granted deliberately from the access panel.
    for key in DEFAULT_NEW_USER_PERMISSIONS:
        db.add(models.UserPermission(user_id=db_user.id, permission_key=key))

    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/access/catalogue", response_model=List[schemas.PermissionInfo])
def read_permission_catalogue(_admin=Depends(require_permission("admin.users"))):
    """Every gateable feature, for building the access grid."""
    return [
        {"key": p.key, "label": p.label, "group": p.group, "description": p.description}
        for p in PERMISSIONS
    ]


@router.get("/access", response_model=List[schemas.UserAccess])
def read_access(db: Session = Depends(get_db), _admin=Depends(require_permission("admin.users"))):
    """Current feature access for every account."""
    users = db.query(models.User).order_by(models.User.name).all()

    stored: dict = {}
    for user_id, key in db.query(
        models.UserPermission.user_id, models.UserPermission.permission_key
    ).all():
        stored.setdefault(user_id, []).append(key)

    return [
        {
            "user_id": user.id,
            "name": user.name,
            "role": user.role,
            "is_admin": user.role == "Admin",
            "effective_permissions": granted_keys(db, user),
            "granted_permissions": sorted(stored.get(user.id, [])),
        }
        for user in users
    ]


@router.put("/{user_id}/access", response_model=schemas.UserAccess)
def set_access(
    user_id: int,
    update: schemas.AccessUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.users")),
):
    """Replaces an account's grants with exactly the submitted set."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    bad = unknown_keys(update.permissions)
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown permission keys: {', '.join(bad)}")

    requested = set(update.permissions)
    existing = {
        row.permission_key: row
        for row in db.query(models.UserPermission).filter(
            models.UserPermission.user_id == user_id
        )
    }

    for key in existing.keys() - requested:
        db.delete(existing[key])
    for key in requested - existing.keys():
        db.add(models.UserPermission(user_id=user_id, permission_key=key))

    db.commit()
    db.refresh(user)

    return {
        "user_id": user.id,
        "name": user.name,
        "role": user.role,
        "is_admin": user.role == "Admin",
        "effective_permissions": granted_keys(db, user),
        "granted_permissions": sorted(requested),
    }
