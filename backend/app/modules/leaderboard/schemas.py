
from pydantic import BaseModel
from typing import Dict

class LeaderboardEntry(BaseModel):
    user_id: int
    name: str
    #: Points earned inside the requested range. Equals all_time_points when no
    #: range is given.
    total_points: int
    #: Lifetime running total from the users table, regardless of range.
    all_time_points: int
    daily_points: int
    weekly_points: int
    #: category_id (as a string key, per JSON) -> points earned in range.
    #: Keyed by category rather than by is_recurring so a column labelled with a
    #: category name actually holds that category's points.
    category_points: Dict[str, int]
