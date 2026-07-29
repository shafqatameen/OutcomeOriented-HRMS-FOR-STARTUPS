from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.modules.users import models as user_models
from app.modules.auth.security import decode_access_token

COOKIE_NAME = "session"


def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    return db.query(user_models.User).filter(user_models.User.id == int(payload["sub"])).first()


def require_user(current_user=Depends(get_current_user)):
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return current_user


def require_admin(current_user=Depends(require_user)):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
