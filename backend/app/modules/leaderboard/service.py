"""Point aggregation, shared by the leaderboard endpoints and the data export.

Kept out of the router so an exported sheet can never disagree with the screen:
both call the same function over the same window.
"""
from datetime import timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.tasks.models import Category, PointLedger, Task, get_ist_now
from app.modules.users.models import User

#: A day window wider than this is refused rather than materialised.
MAX_SERIES_DAYS = 365


def compute_leaderboard(
    db: Session,
    range_start=None,
    range_end=None,
    user_ids: Optional[set] = None,
) -> List[dict]:
    """Point matrix rows, ranked within the range.

    `range_start`/`range_end` are a half-open interval (see core.daterange); omit
    both for all time. `user_ids` restricts which rows come back - ranking is
    still computed over everyone, so a scoped export still reports a true rank.
    """
    now = get_ist_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_day - timedelta(days=now.weekday())

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

    # Rank is assigned before scoping so a member exporting only their own row
    # still sees where they actually stand.
    for position, entry in enumerate(leaderboard, start=1):
        entry["rank"] = position

    if user_ids is not None:
        leaderboard = [entry for entry in leaderboard if entry["user_id"] in user_ids]
    return leaderboard


def compute_daily_series(
    db: Session,
    s_date,
    e_date,
    category_id: Optional[int] = None,
    user_ids: Optional[set] = None,
) -> List[dict]:
    """Points per calendar day, one key per user name, zero-filled.

    `s_date` and `e_date` are both inclusive start-of-day values. The window is
    clamped to MAX_SERIES_DAYS days so an absurd range cannot materialise an
    enormous list.
    """
    users = db.query(User).all()
    if user_ids is not None:
        users = [user for user in users if user.id in user_ids]
    user_names = {user.id: user.name for user in users}

    query = db.query(
        func.date(PointLedger.timestamp).label("day"),
        PointLedger.user_id,
        func.sum(PointLedger.points_awarded).label("total"),
    )

    if category_id:
        query = query.join(Task).filter(Task.category_id == category_id)
    if user_ids is not None:
        query = query.filter(PointLedger.user_id.in_(user_ids))

    query = query.filter(
        PointLedger.timestamp >= s_date,
        PointLedger.timestamp < e_date + timedelta(days=1),
    )
    rows = query.group_by("day", PointLedger.user_id).all()

    days_count = (e_date - s_date).days + 1
    days_count = max(1, min(days_count, MAX_SERIES_DAYS))

    days_list = [(s_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days_count)]
    chart_data = {day: {"date": day} for day in days_list}
    for user in users:
        for day in days_list:
            chart_data[day][user.name] = 0

    for row in rows:
        day_str = row.day
        if hasattr(day_str, "strftime"):
            day_str = day_str.strftime("%Y-%m-%d")
        if day_str in chart_data and row.user_id in user_names:
            chart_data[day_str][user_names[row.user_id]] = row.total

    return sorted(chart_data.values(), key=lambda entry: entry["date"])
