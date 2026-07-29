from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.modules.users import models as user_models
from app.modules.auth import schemas
from app.modules.auth.security import verify_password, create_access_token
from app.modules.auth.dependencies import get_current_user, COOKIE_NAME

router = APIRouter(prefix="/auth", tags=["Auth"])
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # seconds, 7 days


@router.get("/login-options", response_model=List[schemas.LoginOption])
def login_options(db: Session = Depends(get_db)):
    """Public (pre-auth) endpoint for the login form's user picker. Every other
    user-listing endpoint requires a session; this one intentionally doesn't,
    so it only ever returns id/name for accounts that can actually log in."""
    return (
        db.query(user_models.User)
        .filter(user_models.User.password_hash.isnot(None))
        .all()
    )


@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(user_models.User).filter(user_models.User.name == payload.name).first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid name or password")

    token = create_access_token(user.id, user.name, user.role)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return user


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=schemas.UserOut)
def me(current_user=Depends(get_current_user)):
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return current_user
