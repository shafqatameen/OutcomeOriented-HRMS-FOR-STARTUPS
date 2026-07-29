from fastapi import APIRouter, Depends
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import timedelta
from typing import List
from app.core.database import get_db
from app.modules.users.models import User
from app.modules.tasks.models import PointLedger, Task, get_ist_now
from app.modules.leaderboard import schemas
from app.modules.auth.dependencies import require_user

router = APIRouter(tags=["Leaderboard"])

@router.get("/leaderboard", response_model=List[schemas.LeaderboardEntry])
def get_leaderboard(db: Session = Depends(get_db), _user=Depends(require_user)):
    users = db.query(User).order_by(User.total_points.desc()).all()
    
    now = get_ist_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_day - timedelta(days=now.weekday())

    leaderboard = []
    for user in users:
        daily_points = db.query(func.sum(PointLedger.points_awarded)).filter(
            PointLedger.user_id == user.id,
            PointLedger.timestamp >= start_of_day
        ).scalar() or 0
        
        weekly_points = db.query(func.sum(PointLedger.points_awarded)).filter(
            PointLedger.user_id == user.id,
            PointLedger.timestamp >= start_of_week
        ).scalar() or 0
        
        core_points = db.query(func.sum(PointLedger.points_awarded)).join(Task).filter(
            PointLedger.user_id == user.id,
            Task.is_recurring == False
        ).scalar() or 0
        
        adjacent_points = db.query(func.sum(PointLedger.points_awarded)).join(Task).filter(
            PointLedger.user_id == user.id,
            Task.is_recurring == True
        ).scalar() or 0
        
        leaderboard.append({
            "user_id": user.id,
            "name": user.name,
            "total_points": user.total_points,
            "daily_points": daily_points,
            "weekly_points": weekly_points,
            "core_points": core_points,
            "adjacent_points": adjacent_points
        })
        
    return leaderboard

@router.get("/chart-data")
def get_chart_data(category_id: int = None, start_date: str = None, end_date: str = None, db: Session = Depends(get_db), _user=Depends(require_user)):
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
