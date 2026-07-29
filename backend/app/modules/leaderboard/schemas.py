
from pydantic import BaseModel

class LeaderboardEntry(BaseModel):
    user_id: int
    name: str
    total_points: int
    daily_points: int
    weekly_points: int
    core_points: int
    adjacent_points: int
