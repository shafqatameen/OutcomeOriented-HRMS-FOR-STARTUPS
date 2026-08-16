"""Panels: one person's seat and mix, and the same rollup for the whole company."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.daterange import resolve_range
from app.core.database import get_db
from app.modules.auth.dependencies import granted_keys, require_permission
from app.modules.panel import schemas, service
from app.modules.tasks.models import get_ist_now
from app.modules.users.models import User

router = APIRouter(prefix="/panel", tags=["Panel"])


def _build(db: Session, user: User, start_date: Optional[str], end_date: Optional[str]) -> dict:
    range_start, range_end = resolve_range(get_ist_now(), start_date, end_date)
    panel = service.compute_panel(db, user, range_start, range_end)
    panel["open_work"] = service.compute_open_tasks(db, user)
    return panel


@router.get("/me", response_model=schemas.Panel)
def read_my_panel(
    start_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("panel.view")),
):
    return _build(db, current_user, start_date, end_date)


@router.get("/company", response_model=schemas.CompanyPanel)
def read_company_panel(
    start_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("panel.view.all")),
):
    """Where the whole company's effort went, by pillar, function, track and person.

    Gated on `panel.view.all` rather than a key of its own: that permission
    already means "you may look past your own row", and this view is that same
    grant aggregated. Adding a third key would let an account see every
    individual panel but not their sum, which is a distinction without a
    difference - the sum is derivable from the parts either way.
    """
    range_start, range_end = resolve_range(get_ist_now(), start_date, end_date)
    return service.compute_company_panel(db, range_start, range_end)


# Declared after /me and /company so those routes are matched first, following
# the ordering rule tasks.router already documents for /tasks/reorder.
@router.get("/{user_id}", response_model=schemas.Panel)
def read_panel(
    user_id: int,
    start_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Inclusive YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("panel.view")),
):
    """Any account's panel, by id.

    `panel.view` gets you your own row even through this route, so a client that
    always holds a user id does not need the wider grant merely to look at
    itself. Anyone else's needs `panel.view.all`.
    """
    if user_id != current_user.id and "panel.view.all" not in granted_keys(db, current_user):
        raise HTTPException(
            status_code=403,
            detail="Your account can only open its own panel (panel.view.all)",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return _build(db, user, start_date, end_date)
