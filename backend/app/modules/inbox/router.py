from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.dependencies import require_permission
from app.modules.inbox import models, schemas

router = APIRouter(prefix="/inbox", tags=["Inbox"])

#: Long enough for a paragraph of thinking, short enough that the column is not
#: a document store. A capture over this length is a note, and notes get their
#: own bucket later; refusing is better than silently truncating a thought.
MAX_BODY_LENGTH = 10_000


def _clean_body(body: str) -> str:
    cleaned = body.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Capture something first")
    if len(cleaned) > MAX_BODY_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"That is longer than an inbox item holds ({MAX_BODY_LENGTH} characters)",
        )
    return cleaned


def _own(db: Session, user):
    """This account's inbox, oldest first.

    Every read in this module starts here rather than from a bare query, so the
    owner filter cannot be forgotten on a later endpoint. No route in this file
    accepts a user id at all - your inbox is reachable only by being you.

    Oldest first because that is the order clarifying happens in: top item, one
    at a time, all the way to zero. Showing newest first would invite skimming
    for the interesting one, which is how an inbox stops emptying.
    """
    return (
        db.query(models.InboxItem)
        .filter(models.InboxItem.user_id == user.id)
        .order_by(models.InboxItem.created_at.asc(), models.InboxItem.id.asc())
    )


@router.get("", response_model=List[schemas.InboxItem])
def read_inbox(
    db: Session = Depends(get_db),
    user=Depends(require_permission("capture.write")),
):
    return _own(db, user).all()


@router.get("/count", response_model=schemas.InboxCount)
def read_inbox_count(
    db: Session = Depends(get_db),
    user=Depends(require_permission("capture.write")),
):
    """The unclarified count, for the rail. Cheap enough to ask for on every page."""
    return {"count": _own(db, user).count()}


@router.post("", response_model=schemas.InboxItem, status_code=201)
def capture(
    item: schemas.InboxItemCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("capture.write")),
):
    """Adds one item to your own inbox.

    Note what this endpoint does not do: it does not create a task, and so it is
    not gated behind `admin.tasks`. Assigning work to another person stays
    privileged exactly as before - capturing your own open loop never is, or
    people keep it in their head instead and the system is worth nothing.
    """
    db_item = models.InboxItem(user_id=user.id, body=_clean_body(item.body))
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@router.delete("/{item_id}")
def discard(
    item_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("capture.write")),
):
    """Throws one item away, unprocessed.

    A hard delete, and deliberately not a soft one. An inbox item has never been
    clarified, so it is attached to no project, holds no points and has no ledger
    row - there is nothing downstream for a tombstone to protect, and keeping
    discarded thoughts around would make the inbox count lie.

    An item belonging to someone else answers 404, not 403: a 403 would confirm
    that a given row exists, and whose inbox holds what is not something this API
    should be willing to tell anyone.
    """
    db_item = (
        db.query(models.InboxItem)
        .filter(models.InboxItem.id == item_id, models.InboxItem.user_id == user.id)
        .first()
    )
    if not db_item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    db.delete(db_item)
    db.commit()
    return {"message": "Discarded", "item_id": item_id}
