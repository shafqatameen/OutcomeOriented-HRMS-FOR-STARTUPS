from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.integrity import Blocker, deletion_blocked
from app.modules.users import models, schemas
from app.modules.tasks import models as task_models
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


def _guard_not_self(actor, target, verb: str) -> None:
    """Stops an administrator locking themselves out with their own button."""
    if actor.id == target.id:
        raise HTTPException(status_code=400, detail=f"You cannot {verb} your own account.")


def _guard_not_last_admin(db: Session, target, verb: str) -> None:
    """Keeps at least one active Admin in existence.

    Not covered by the self guard: `admin.users` can be granted to a Member, and
    that Member could otherwise deactivate the only administrator. Nobody would
    then hold the role that bypasses permission checks, so any feature nobody
    has been granted becomes unreachable for everyone.
    """
    if target.role != "Admin":
        return

    others = (
        db.query(models.User)
        .filter(
            models.User.role == "Admin",
            models.User.is_active.is_(True),
            models.User.id != target.id,
        )
        .count()
    )
    if others == 0:
        raise HTTPException(
            status_code=400,
            detail=f"You cannot {verb} the last active administrator.",
        )


@router.patch("/{user_id}", response_model=schemas.User)
def update_user(
    user_id: int,
    update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.users")),
):
    """Renames an account and/or sets a new password.

    Names are how people sign in and are unique, so a clash is refused rather
    than silently allowed - two accounts answering to the same name would make
    the login picker ambiguous.

    Changing the password does not end sessions that are already open: the token
    carries no password version to compare against. Deactivate then restore the
    account if an existing session needs to be cut off as well.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if update.name is not None:
        name = update.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")

        taken = (
            db.query(models.User)
            .filter(models.User.name == name, models.User.id != user_id)
            .first()
        )
        if taken:
            raise HTTPException(status_code=400, detail="A user with that name already exists")
        user.name = name

    if update.password is not None:
        # An empty string here is a mistake rather than an intent: it would
        # otherwise hash to a real, guessable password. Callers that mean "leave
        # it alone" omit the field entirely.
        if not update.password.strip():
            raise HTTPException(status_code=400, detail="Password cannot be empty")
        user.password_hash = hash_password(update.password)

    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/active", response_model=schemas.User)
def set_user_active(
    user_id: int,
    update: schemas.UserActiveUpdate,
    db: Session = Depends(get_db),
    actor=Depends(require_permission("admin.users")),
):
    """Blocks or restores sign-in for one account.

    Deactivation is deliberately narrow: it stops the account logging in and
    drops it from the login picker, and does nothing else. Tasks, ledger rows
    and leaderboard position all stay exactly as they were, which is what makes
    restoring it a single flip back rather than a recovery job.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not update.is_active:
        _guard_not_self(actor, user, "deactivate")
        _guard_not_last_admin(db, user, "deactivate")

    user.is_active = update.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    actor=Depends(require_permission("admin.users")),
):
    """Deletes an account, refusing while any of its history still exists.

    SQLite is running without `PRAGMA foreign_keys` (see core.database), so a
    DELETE here would not fail on the child rows - it would quietly orphan the
    account's tasks and ledger entries, and the leaderboard is computed from
    that ledger. An account with any history is therefore refused with the same
    structured 409 the category delete uses, naming the blast radius and
    pointing at deactivation, which preserves all of it.

    Only genuinely empty accounts are removed. Their permission grants go with
    them through the delete-orphan cascade on User.permissions.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _guard_not_self(actor, user, "delete")
    _guard_not_last_admin(db, user, "delete")

    task_count = db.query(task_models.Task).filter(task_models.Task.user_id == user_id).count()
    ledger_count = (
        db.query(task_models.PointLedger).filter(task_models.PointLedger.user_id == user_id).count()
    )

    blockers = []
    if task_count:
        blockers.append(Blocker("tasks", task_count))
    if ledger_count:
        blockers.append(Blocker("point ledger entries", ledger_count, f"{user.total_points} points earned"))

    if blockers:
        raise deletion_blocked(
            entity="user",
            name=user.name,
            blockers=blockers,
            remedy="Deactivate this account instead - it blocks sign-in and keeps the history intact.",
        )

    db.delete(user)
    db.commit()

    return {"message": "User deleted", "user_id": user_id}


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
