"""Someday / Reference / Waiting — the three holding lists.

Every route here is scoped to the caller and none of them accepts a user id, for
the reason models.py gives: these lists only get used honestly if their owner is
certain nobody else is reading them. `_own` is the single entry point to each
table so that guarantee cannot be dropped by a later endpoint.

Delete is a hard delete throughout. Nothing in these three tables carries points,
a ledger row or a dependent record, so there is nothing downstream that a
tombstone would protect - and a Someday list that quietly keeps everything you
ever rejected is one you stop trusting to be a real shortlist.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.dependencies import require_permission
from app.modules.buckets import models, schemas
from app.modules.tasks.models import get_ist_now
from app.modules.users.models import User

router = APIRouter(tags=["Lists"])

MAX_TITLE = 500
MAX_BODY = 20_000

#: The one grant that opens all three lists. Default-granted, on the same
#: reasoning as `capture.write`: these are private, personal, and create nothing
#: anybody else can see, so withholding the key protects nothing and only leaves
#: an account unable to file what it has already captured.
PERMISSION = "lists.write"


def _clean(value: str, field: str, limit: int) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{field} must not be empty")
    if len(cleaned) > limit:
        raise HTTPException(status_code=400, detail=f"{field} is longer than {limit} characters")
    return cleaned


def _clean_optional(value: Optional[str], field: str, limit: int) -> Optional[str]:
    """Blank collapses to null rather than to an empty string.

    So clearing a note leaves the column genuinely empty, and `notes` is never
    the string "" masquerading as content the UI then renders as a blank line.
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > limit:
        raise HTTPException(status_code=400, detail=f"{field} is longer than {limit} characters")
    return cleaned


def _own(db: Session, model, user):
    return db.query(model).filter(model.user_id == user.id)


def _get_own(db: Session, model, item_id: int, user, label: str):
    """404 - never 403 - for somebody else's row, so the API will not confirm it exists."""
    row = _own(db, model, user).filter(model.id == item_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


# --- Someday / Maybe ---------------------------------------------------------

@router.get("/someday", response_model=List[schemas.SomedayItem])
def read_someday(db: Session = Depends(get_db), user=Depends(require_permission(PERMISSION))):
    """Newest first — the opposite of the inbox, and on purpose.

    Someday is browsed, not processed to zero. There is no obligation to reach
    the bottom of it, so the useful thing at the top is what you thought of most
    recently rather than the oldest thing you have not dealt with.
    """
    return (
        _own(db, models.SomedayItem, user)
        .order_by(models.SomedayItem.created_at.desc(), models.SomedayItem.id.desc())
        .all()
    )


@router.post("/someday", response_model=schemas.SomedayItem, status_code=201)
def create_someday(
    item: schemas.SomedayCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    row = models.SomedayItem(
        user_id=user.id,
        title=_clean(item.title, "Title", MAX_TITLE),
        notes=_clean_optional(item.notes, "Notes", MAX_BODY),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/someday/{item_id}", response_model=schemas.SomedayItem)
def update_someday(
    item_id: int,
    update: schemas.SomedayUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    row = _get_own(db, models.SomedayItem, item_id, user, "Someday item")
    if update.title is None and update.notes is None and update.reviewed is None:
        raise HTTPException(status_code=400, detail="Provide something to update")

    if update.title is not None:
        row.title = _clean(update.title, "Title", MAX_TITLE)
    if update.notes is not None:
        row.notes = _clean_optional(update.notes, "Notes", MAX_BODY)
    # Only ever set, never cleared: "this has been reconsidered at least once"
    # is not a fact that can stop being true.
    if update.reviewed:
        row.last_reviewed_at = get_ist_now()

    db.commit()
    db.refresh(row)
    return row


@router.delete("/someday/{item_id}")
def delete_someday(
    item_id: int, db: Session = Depends(get_db), user=Depends(require_permission(PERMISSION))
):
    row = _get_own(db, models.SomedayItem, item_id, user, "Someday item")
    db.delete(row)
    db.commit()
    return {"message": "Deleted", "item_id": item_id}


# --- Reference ---------------------------------------------------------------

@router.get("/reference", response_model=List[schemas.ReferenceItem])
def read_reference(db: Session = Depends(get_db), user=Depends(require_permission(PERMISSION))):
    return (
        _own(db, models.ReferenceItem, user)
        .order_by(models.ReferenceItem.created_at.desc(), models.ReferenceItem.id.desc())
        .all()
    )


@router.post("/reference", response_model=schemas.ReferenceItem, status_code=201)
def create_reference(
    item: schemas.ReferenceCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    row = models.ReferenceItem(
        user_id=user.id,
        title=_clean(item.title, "Title", MAX_TITLE),
        body=_clean(item.body, "Body", MAX_BODY),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/reference/{item_id}", response_model=schemas.ReferenceItem)
def update_reference(
    item_id: int,
    update: schemas.ReferenceUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    row = _get_own(db, models.ReferenceItem, item_id, user, "Reference item")
    if update.title is None and update.body is None:
        raise HTTPException(status_code=400, detail="Provide something to update")

    if update.title is not None:
        row.title = _clean(update.title, "Title", MAX_TITLE)
    # Not _clean_optional: body is the content, and blanking it would leave a
    # reference note there is no reason to ever open again.
    if update.body is not None:
        row.body = _clean(update.body, "Body", MAX_BODY)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/reference/{item_id}")
def delete_reference(
    item_id: int, db: Session = Depends(get_db), user=Depends(require_permission(PERMISSION))
):
    row = _get_own(db, models.ReferenceItem, item_id, user, "Reference item")
    db.delete(row)
    db.commit()
    return {"message": "Deleted", "item_id": item_id}


# --- Waiting / Delegate ------------------------------------------------------

def resolve_delegate(db: Session, delegate_user_id: Optional[int], delegate_name: Optional[str]):
    """(id, name) for the person owing this, or a 400 if there is nobody.

    An account wins over typed text when both arrive, and the name is copied off
    the account rather than trusted from the caller - so the list cannot claim
    somebody is waiting on a colleague under a name that colleague does not have.
    """
    if delegate_user_id is not None:
        delegate = db.query(User).filter(User.id == delegate_user_id).first()
        if not delegate:
            raise HTTPException(status_code=404, detail="That account does not exist")
        return delegate.id, delegate.name

    cleaned = (delegate_name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Say who you are waiting on")
    if len(cleaned) > MAX_TITLE:
        raise HTTPException(status_code=400, detail="That name is too long")
    return None, cleaned


def serialize_waiting(row: models.WaitingItem) -> dict:
    today = get_ist_now().date()
    since = row.waiting_since.date() if row.waiting_since else today
    return {
        "id": row.id,
        "title": row.title,
        "notes": row.notes,
        "delegate_user_id": row.delegate_user_id,
        "delegate_name": row.delegate_name,
        "waiting_since": row.waiting_since,
        "follow_up_date": row.follow_up_date,
        "status": row.status,
        "closed_at": row.closed_at,
        "days_waiting": max((today - since).days, 0),
        # A closed item is never due: you are not waiting on it any more, and a
        # chase date that outlived the thing it was chasing is pure noise.
        "is_due": (
            row.status == "Open"
            and row.follow_up_date is not None
            and row.follow_up_date <= today
        ),
    }


@router.get("/waiting", response_model=List[schemas.WaitingItem])
def read_waiting(
    include_closed: bool = Query(False, description="Include items already settled."),
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    """Longest-waiting first, which is the order that makes the list worth opening."""
    query = _own(db, models.WaitingItem, user)
    if not include_closed:
        query = query.filter(models.WaitingItem.status == "Open")
    rows = query.order_by(
        models.WaitingItem.waiting_since.asc(), models.WaitingItem.id.asc()
    ).all()
    return [serialize_waiting(row) for row in rows]


@router.post("/waiting", response_model=schemas.WaitingItem, status_code=201)
def create_waiting(
    item: schemas.WaitingCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    delegate_id, delegate_name = resolve_delegate(db, item.delegate_user_id, item.delegate_name)
    row = models.WaitingItem(
        user_id=user.id,
        title=_clean(item.title, "Title", MAX_TITLE),
        notes=_clean_optional(item.notes, "Notes", MAX_BODY),
        delegate_user_id=delegate_id,
        delegate_name=delegate_name,
        follow_up_date=item.follow_up_date,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_waiting(row)


@router.patch("/waiting/{item_id}", response_model=schemas.WaitingItem)
def update_waiting(
    item_id: int,
    update: schemas.WaitingUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission(PERMISSION)),
):
    row = _get_own(db, models.WaitingItem, item_id, user, "Waiting item")
    if all(v is None for v in (update.title, update.notes, update.follow_up_date, update.status)):
        raise HTTPException(status_code=400, detail="Provide something to update")

    if update.title is not None:
        row.title = _clean(update.title, "Title", MAX_TITLE)
    if update.notes is not None:
        row.notes = _clean_optional(update.notes, "Notes", MAX_BODY)
    if update.follow_up_date is not None:
        row.follow_up_date = update.follow_up_date
    if update.status is not None and update.status != row.status:
        row.status = update.status
        # Cleared on reopen, so a reopened item does not carry a closing date
        # that its own status contradicts.
        row.closed_at = get_ist_now() if update.status == "Closed" else None

    db.commit()
    db.refresh(row)
    return serialize_waiting(row)


@router.delete("/waiting/{item_id}")
def delete_waiting(
    item_id: int, db: Session = Depends(get_db), user=Depends(require_permission(PERMISSION))
):
    row = _get_own(db, models.WaitingItem, item_id, user, "Waiting item")
    db.delete(row)
    db.commit()
    return {"message": "Deleted", "item_id": item_id}
