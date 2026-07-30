from fastapi import APIRouter, Depends
from datetime import timedelta
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.daterange import resolve_range, start_of_day
from app.core.database import get_db
from app.modules.tasks.models import get_ist_now
from app.modules.leaderboard import schemas
from app.modules.leaderboard.service import compute_daily_series, compute_leaderboard
from app.modules.auth.dependencies import require_permission

router = APIRouter(tags=["Leaderboard"])


@router.get("/leaderboard", response_model=List[schemas.LeaderboardEntry])
def get_leaderboard(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("leaderboard.view")),
):
    """Point matrix, optionally restricted to a date range.

    Both bounds are inclusive calendar days. Omit them for all time. Ranking and
    the per-category breakdown are both computed inside the range, so 1st place
    means 1st place for the range being asked about.
    """
    range_start, range_end = resolve_range(get_ist_now(), start_date, end_date)
    return compute_leaderboard(db, range_start, range_end)


@router.get("/chart-data")
def get_chart_data(
    category_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("leaderboard.view")),
):
    """Points per day per user, zero-filled. Defaults to the last 7 days."""
    now = get_ist_now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    s_date = start_of_day(now, start_date) if start_date else today - timedelta(days=6)
    e_date = start_of_day(now, end_date) if end_date else today

    return compute_daily_series(db, s_date, e_date, category_id)
