from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.emails import InvalidEmail, normalise_email
from app.core.integrity import Blocker, deletion_blocked
from app.core.mail import MailError
from app.modules.auth import notifications
from app.modules.users import models, schemas
from app.modules.tasks import models as task_models
from app.modules.tasks.models import get_ist_now
from app.modules.org import models as org_models
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

def _resolve_email(db: Session, raw: str, exclude_user_id: int = 0) -> str:
    """Normalises a submitted address and refuses one already in use.

    Checked here rather than left to the unique index: SQLAlchemy would surface
    the collision as an IntegrityError and a 500, and "that address is already
    on another account" is an ordinary thing for an administrator to have typed,
    not a server fault.
    """
    try:
        email = normalise_email(raw)
    except InvalidEmail as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    taken = (
        db.query(models.User)
        .filter(models.User.email == email, models.User.id != exclude_user_id)
        .first()
    )
    if taken:
        raise HTTPException(
            status_code=400,
            detail=f"{email} is already the sign-in address for another account.",
        )
    return email


@router.post("", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), _admin=Depends(require_permission("admin.users"))):
    if db.query(models.User).filter(models.User.name == user.name).first():
        raise HTTPException(status_code=400, detail="A user with that name already exists")

    email = _resolve_email(db, user.email) if user.email is not None else None

    now = get_ist_now()
    db_user = models.User(
        name=user.name,
        role=user.role,
        email=email,
        password_hash=hash_password(user.password),
        # An account made here is approved by the act of making it - the person
        # doing it is the same person who would otherwise approve it, and leaving
        # these null would drop every admin-created colleague into the pending
        # queue behind the administrator who just created them.
        approved_at=now,
        # Likewise verified: an administrator typing a colleague's address is
        # the proof. There is no mailed link for this path, so waiting for one
        # would mean waiting forever.
        email_verified_at=now if email else None,
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
    """Renames an account and/or sets a new password or sign-in address.

    Names remain unique and a clash is still refused: an account with no address
    yet signs in by name, so two accounts answering to the same one would make
    that lookup ambiguous.

    Setting `email` is the one-way switch onto email sign-in for this account.
    It cannot be cleared back to null here - see UserUpdate.

    Neither a new password nor a new address ends sessions that are already
    open: the token carries no password version to compare against. Deactivate
    then restore the account if an existing session needs to be cut off as well.
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

    if update.email is not None:
        user.email = _resolve_email(db, update.email, exclude_user_id=user_id)

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

    Deactivation is deliberately narrow: it stops the account logging in, and
    does nothing else. Tasks, ledger rows and leaderboard position all stay
    exactly as they were, which is what makes restoring it a single flip back
    rather than a recovery job.
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


@router.get("/pending", response_model=List[schemas.PendingUser])
def read_pending(db: Session = Depends(get_db), _admin=Depends(require_permission("admin.users"))):
    """Accounts that have confirmed an address and are waiting to be let in.

    Unverified sign-ups are excluded. Somebody who typed an address and never
    followed the link has proved nothing, and listing them would fill this queue
    with typos and with addresses their owners never asked to register - which
    is also how the queue becomes a place an administrator stops looking.
    """
    return (
        db.query(models.User)
        .filter(models.User.approved_at.is_(None))
        .filter(models.User.email_verified_at.isnot(None))
        .order_by(models.User.id)
        .all()
    )


@router.post("/{user_id}/approve", response_model=schemas.User)
def approve_user(
    user_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.users")),
):
    """Lets a pending account in, with the same starting access as any new hire.

    Idempotent: approving an already-approved account changes nothing and does
    not re-send the mail. Two administrators clicking the same row is an obvious
    way to reach this, and it should not produce a duplicate welcome or reset
    somebody's permissions back to the defaults.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.approved_at is not None:
        return user

    if user.email_verified_at is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "This person has not confirmed their email address yet. "
                "There is nothing to approve until they do."
            ),
        )

    user.approved_at = get_ist_now()
    user.is_active = True

    # The same defaults create_user grants, and granted here rather than at
    # sign-up so that a pending account carries no permissions at all while it
    # waits. Existing rows are left alone, which is what keeps re-approving a
    # restored account from wiping access somebody deliberately widened.
    already = {
        row[0]
        for row in db.query(models.UserPermission.permission_key)
        .filter(models.UserPermission.user_id == user.id)
        .all()
    }
    for key in DEFAULT_NEW_USER_PERMISSIONS:
        if key not in already:
            db.add(models.UserPermission(user_id=user.id, permission_key=key))

    db.commit()
    db.refresh(user)

    if user.email:
        address, name = user.email, user.name

        def notify():
            try:
                notifications.send_approved(address, name)
            except MailError as exc:
                # Logged, not raised: the approval has already been committed,
                # and failing the request would invite the administrator to
                # click again on an account that is in fact already approved.
                print(f"[mail:failed] approval notice -> {address}: {exc}")

        background.add_task(notify)

    return user


@router.patch("/{user_id}/seat", response_model=schemas.User)
def set_user_seat(
    user_id: int,
    update: schemas.SeatUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    """Sets or clears the function this person is meant to be working in.

    A seat is a statement of intent, never a restriction: it changes nothing
    about what this account may be assigned or may complete. Its only job is to
    give the panel something to measure drift against, which is why clearing it
    (a null) is a first-class outcome rather than an error.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if update.home_function_id is not None:
        function = (
            db.query(org_models.Function)
            .filter(org_models.Function.id == update.home_function_id)
            .first()
        )
        if not function:
            raise HTTPException(status_code=404, detail="Function not found")

    user.home_function_id = update.home_function_id
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
