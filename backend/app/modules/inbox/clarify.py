"""Clarify: the one way an inbox item leaves the inbox.

Kept out of router.py because capture and clarify are opposite jobs. Capture
must ask nothing; clarify exists precisely to ask. Putting them in one file
invites the two to blur, and the blurred version - a capture form with a
category picker on it - is the one that stops getting used.

**Atomicity is the whole contract.** Each outcome creates its destination row and
deletes the inbox item in a single transaction. The cheat sheet's rule is that
stuff never goes back in the inbox, and a half-applied clarify is exactly how it
would: a Someday item written but the inbox row left behind means the same
thought now exists twice, and the copy in the inbox will be clarified again.

Note that the request body below carries a lot of optional fields, which is the
shape models.py argues against for storage. That is deliberate and not a
contradiction: this is a boundary payload whose per-outcome requirements are
checked in `_dispatch` before anything is written, so what reaches the database
is still the strict, non-nullable row each table demands. Loose at the door,
strict in the tables.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing_extensions import Literal

from app.core.database import get_db
from app.modules.auth.dependencies import granted_keys, require_permission
from app.modules.buckets import models as bucket_models
from app.modules.buckets.router import resolve_delegate
from app.modules.goals import models as goal_models
from app.modules.inbox import models
from app.modules.tasks.models import Category, Task

router = APIRouter(prefix="/inbox", tags=["Inbox"])

Outcome = Literal["trash", "reference", "someday", "waiting", "next_action", "project"]


class ClarifyRequest(BaseModel):
    outcome: Outcome

    #: Defaults to the inbox item's first line for every outcome that needs one.
    title: Optional[str] = None
    notes: Optional[str] = None

    # reference
    body: Optional[str] = None

    # waiting
    delegate_user_id: Optional[int] = None
    delegate_name: Optional[str] = None
    follow_up_date: Optional[date] = None

    # next_action, and the first action of a project
    category_id: Optional[int] = None
    function_id: Optional[int] = None
    milestone_id: Optional[int] = None
    points: Optional[int] = None
    assignee_id: Optional[int] = None

    # project
    goal_id: Optional[int] = None
    first_action_title: Optional[str] = None


class ClarifyResult(BaseModel):
    outcome: str
    #: What the caller should be told happened, in words. Built server-side so
    #: the API and any UI cannot describe the same write differently.
    summary: str
    item_id: int
    created_id: Optional[int] = None
    created_action_id: Optional[int] = None


def _require(db: Session, user, key: str) -> None:
    """A second permission check, inside a route already gated on `capture.write`.

    Clarifying is always your own business, but *where* an item lands may not
    be: turning one into a scored task mints points, so that branch answers to
    the same `admin.tasks` grant that has always guarded task creation. Doing
    this inline rather than as a route dependency is what lets one endpoint hold
    branches with different privileges.
    """
    if user.role == "Admin":
        return
    if key not in granted_keys(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Clarifying into that needs the {key} permission on your account",
        )


def _first_line(text: str) -> str:
    """A title from a captured blob.

    Captures are often a sentence and sometimes a paragraph; the first line is
    almost always the thing itself, with any detail underneath it.
    """
    line = next((part.strip() for part in text.splitlines() if part.strip()), "")
    return (line[:497] + "...") if len(line) > 500 else line


def _title_for(request: ClarifyRequest, item: models.InboxItem) -> str:
    title = (request.title or "").strip() or _first_line(item.body)
    if not title:
        raise HTTPException(status_code=400, detail="Give this a title")
    return title


def _dispatch(request: ClarifyRequest, item: models.InboxItem, db: Session, user) -> ClarifyResult:
    """Builds the destination row(s). Adds to the session; never commits."""
    outcome = request.outcome

    if outcome == "trash":
        return ClarifyResult(
            outcome=outcome, item_id=item.id, summary="Discarded without action"
        )

    if outcome == "reference":
        # The captured text is the note unless something better was typed. A
        # reference item with an empty body is refused at the table.
        body = (request.body or "").strip() or item.body.strip()
        row = bucket_models.ReferenceItem(
            user_id=user.id, title=_title_for(request, item), body=body
        )
        db.add(row)
        db.flush()
        return ClarifyResult(
            outcome=outcome, item_id=item.id, created_id=row.id,
            summary=f"Filed as reference: {row.title}",
        )

    if outcome == "someday":
        title = _title_for(request, item)
        notes = (request.notes or "").strip() or None
        # Keep whatever the capture said beyond its first line, rather than
        # silently dropping it when the title is taken from line one.
        if notes is None:
            remainder = item.body.strip()[len(_first_line(item.body)):].strip()
            notes = remainder or None
        row = bucket_models.SomedayItem(user_id=user.id, title=title, notes=notes)
        db.add(row)
        db.flush()
        return ClarifyResult(
            outcome=outcome, item_id=item.id, created_id=row.id,
            summary=f"Parked in Someday/Maybe: {row.title}",
        )

    if outcome == "waiting":
        delegate_id, delegate_name = resolve_delegate(
            db, request.delegate_user_id, request.delegate_name
        )
        row = bucket_models.WaitingItem(
            user_id=user.id,
            title=_title_for(request, item),
            notes=(request.notes or "").strip() or None,
            delegate_user_id=delegate_id,
            delegate_name=delegate_name,
            follow_up_date=request.follow_up_date,
        )
        db.add(row)
        db.flush()
        return ClarifyResult(
            outcome=outcome, item_id=item.id, created_id=row.id,
            summary=f"Waiting on {delegate_name}: {row.title}",
        )

    if outcome == "next_action":
        _require(db, user, "admin.tasks")
        task = _build_task(
            db,
            title=_title_for(request, item),
            category_id=request.category_id,
            assignee_id=request.assignee_id or user.id,
            function_id=request.function_id,
            milestone_id=request.milestone_id,
            points=request.points,
        )
        db.add(task)
        db.flush()
        return ClarifyResult(
            outcome=outcome, item_id=item.id, created_id=task.id,
            summary=f"Next action: {task.title}",
        )

    if outcome == "project":
        _require(db, user, "admin.goals")
        # Creating the project's first action is not optional, so this branch
        # needs the task grant too - see the invariant below.
        _require(db, user, "admin.tasks")

        goal = db.query(goal_models.Goal).filter(goal_models.Goal.id == request.goal_id).first()
        if not goal:
            raise HTTPException(status_code=404, detail="Pick a goal for this project to sit under")

        first_action = (request.first_action_title or "").strip()
        if not first_action:
            # The single most valuable rule in the whole system, enforced at the
            # only moment it is cheap to enforce. A project with no next action
            # is a wish; you find out months later, during a review, that it
            # never moved because nobody ever decided what moving would mean.
            raise HTTPException(
                status_code=400,
                detail="A project needs its first next action. What is the very next "
                       "physical thing someone would do on this?",
            )

        milestone = goal_models.Milestone(title=_title_for(request, item), goal_id=goal.id)
        db.add(milestone)
        db.flush()

        task = _build_task(
            db,
            title=first_action,
            category_id=request.category_id,
            assignee_id=request.assignee_id or user.id,
            function_id=request.function_id,
            milestone_id=milestone.id,
            points=request.points,
        )
        db.add(task)
        db.flush()
        return ClarifyResult(
            outcome=outcome, item_id=item.id, created_id=milestone.id, created_action_id=task.id,
            summary=f"Project '{milestone.title}' under {goal.title}, starting with '{task.title}'",
        )

    raise HTTPException(status_code=400, detail=f"Unknown outcome: {outcome}")


def _build_task(db: Session, *, title, category_id, assignee_id, function_id, milestone_id, points):
    """A Task, with the same validation the tasks router applies to its own writes."""
    if category_id is None:
        raise HTTPException(status_code=400, detail="Pick a category — it is what prices the task")
    if not db.query(Category).filter(Category.id == category_id).first():
        raise HTTPException(status_code=404, detail="Category not found")
    if points is not None and points < 0:
        raise HTTPException(status_code=400, detail="Points must not be negative")
    return Task(
        title=title,
        user_id=assignee_id,
        category_id=category_id,
        function_id=function_id,
        milestone_id=milestone_id,
        points=points,
        status="Pending",
    )


@router.post("/{item_id}/clarify", response_model=ClarifyResult)
def clarify(
    item_id: int,
    request: ClarifyRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("capture.write")),
):
    """Decides what one inbox item is, and moves it there.

    Gated on `capture.write` because it is your own inbox; branches that write
    somewhere shared check their own grant on top (see `_require`).

    The destination row and the inbox delete share one commit. If anything in
    `_dispatch` raises - an unknown category, a project with no first action -
    nothing is written at all and the item is still sitting in the inbox, which
    is the only safe way to fail here.
    """
    item = (
        db.query(models.InboxItem)
        .filter(models.InboxItem.id == item_id, models.InboxItem.user_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    try:
        result = _dispatch(request, item, db, user)
        db.delete(item)
        db.commit()
    except Exception:
        # Including the HTTPExceptions raised for bad input: those leave a
        # flushed-but-uncommitted row in the session, and without this the next
        # request on this connection could carry it in.
        db.rollback()
        raise

    return result
