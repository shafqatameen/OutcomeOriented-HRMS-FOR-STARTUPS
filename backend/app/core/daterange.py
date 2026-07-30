"""Calendar-day window parsing, shared by every range-filtered read.

Stored timestamps are naive IST wall-clock (see tasks.models.get_ist_now), so
bounds are built by replacing the date parts of an IST `now`. That keeps both
sides of every comparison in the same frame of reference.
"""
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fastapi import HTTPException


def start_of_day(now, value: str):
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


def resolve_range(
    now,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Inclusive calendar bounds as a half-open interval.

    Both inputs are optional; omitting them means all time. The returned upper
    bound is the day *after* end_date so `timestamp < range_end` includes every
    moment of end_date itself.
    """
    range_start = start_of_day(now, start_date) if start_date else None
    range_end = start_of_day(now, end_date) + timedelta(days=1) if end_date else None
    if range_start and range_end and range_end <= range_start:
        raise HTTPException(status_code=400, detail="end_date must not be before start_date")
    return range_start, range_end
