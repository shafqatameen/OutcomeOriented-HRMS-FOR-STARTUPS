from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from app.core.database import get_db
from app.modules.users.models import User
from app.modules.tasks.models import Category, PointLedger, Task, get_ist_now
from app.modules.leaderboard import schemas
from app.modules.auth.dependencies import require_permission

router = APIRouter(tags=["Leaderboard"])


def _start_of_day(now, value: str):
    """Parses YYYY-MM-DD onto `now`, keeping its timezone so comparisons against
    stored timestamps stay in the same frame of reference."""
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date '{value}', expected YYYY-MM-DD")
    return now.replace(
        year=parsed.year, month=parsed.month, day=parsed.day,
        hour=0, minute=0, second=0, microsecond=0,
    )


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
    now = get_ist_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_day - timedelta(days=now.weekday())

    range_start = _start_of_day(now, start_date) if start_date else None
    # Exclusive upper bound: the day after end_date, so end_date itself is included.
    range_end = _start_of_day(now, end_date) + timedelta(days=1) if end_date else None
    if range_start and range_end and range_end <= range_start:
        raise HTTPException(status_code=400, detail="end_date must not be before start_date")

    def in_range(query):
        if range_start is not None:
            query = query.filter(PointLedger.timestamp >= range_start)
        if range_end is not None:
            query = query.filter(PointLedger.timestamp < range_end)
        return query

    users = db.query(User).all()
    category_ids = [row[0] for row in db.query(Category.id).all()]

    # Three grouped queries instead of four per user.
    range_totals = dict(
        in_range(
            db.query(PointLedger.user_id, func.sum(PointLedger.points_awarded))
        ).group_by(PointLedger.user_id).all()
    )

    by_user_category = {
        (user_id, category_id): total
        for user_id, category_id, total in in_range(
            db.query(
                PointLedger.user_id,
                Task.category_id,
                func.sum(PointLedger.points_awarded),
            ).join(Task, Task.id == PointLedger.task_id)
        ).group_by(PointLedger.user_id, Task.category_id).all()
    }

    daily = dict(
        db.query(PointLedger.user_id, func.sum(PointLedger.points_awarded))
        .filter(PointLedger.timestamp >= start_of_day)
        .group_by(PointLedger.user_id).all()
    )
    weekly = dict(
        db.query(PointLedger.user_id, func.sum(PointLedger.points_awarded))
        .filter(PointLedger.timestamp >= start_of_week)
        .group_by(PointLedger.user_id).all()
    )

    leaderboard = [
        {
            "user_id": user.id,
            "name": user.name,
            "total_points": range_totals.get(user.id) or 0,
            "all_time_points": user.total_points or 0,
            "daily_points": daily.get(user.id) or 0,
            "weekly_points": weekly.get(user.id) or 0,
            "category_points": {
                str(category_id): by_user_category.get((user.id, category_id)) or 0
                for category_id in category_ids
            },
        }
        for user in users
    ]

    # Rank by the range being viewed, with name as a stable tiebreak.
    leaderboard.sort(key=lambda entry: (-entry["total_points"], entry["name"].lower()))
    return leaderboard

@router.get("/chart-data")
def get_chart_data(category_id: int = None, start_date: str = None, end_date: str = None, db: Session = Depends(get_db), _user=Depends(require_permission("leaderboard.view"))):
    users = db.query(User).all()
    user_names = {u.id: u.name for u in users}
    
    now = get_ist_now()
    
    if start_date:
        s_date_naive = datetime.strptime(start_date, "%Y-%m-%d")
        s_date = now.replace(year=s_date_naive.year, month=s_date_naive.month, day=s_date_naive.day, hour=0, minute=0, second=0, microsecond=0)
    else:
        s_date = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)

    if end_date:
        e_date_naive = datetime.strptime(end_date, "%Y-%m-%d")
        e_date = now.replace(year=e_date_naive.year, month=e_date_naive.month, day=e_date_naive.day, hour=0, minute=0, second=0, microsecond=0)
    else:
        e_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    query = db.query(
        func.date(PointLedger.timestamp).label("day"),
        PointLedger.user_id,
        func.sum(PointLedger.points_awarded).label("total")
    )
    
    if category_id:
        query = query.join(Task).filter(Task.category_id == category_id)
        
    query = query.filter(PointLedger.timestamp >= s_date, PointLedger.timestamp <= (e_date + timedelta(days=1)))
    query = query.group_by("day", PointLedger.user_id).all()
    
    delta = e_date - s_date
    days_count = delta.days + 1
    if days_count < 1: days_count = 1
    if days_count > 365: days_count = 365
    
    days_list = [(s_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days_count)]
    chart_data = {day: {"date": day} for day in days_list}
    for u in users:
        for day in days_list:
            chart_data[day][u.name] = 0
            
    for row in query:
        day_str = row.day
        if hasattr(day_str, 'strftime'):
            day_str = day_str.strftime("%Y-%m-%d")
        if day_str in chart_data:
            chart_data[day_str][user_names[row.user_id]] = row.total
            
    return sorted(list(chart_data.values()), key=lambda x: x["date"])
