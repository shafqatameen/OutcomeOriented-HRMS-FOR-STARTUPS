import os
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.modules.users import models as user_models
from app.modules.auth import schemas
from app.modules.auth.security import verify_password, create_access_token
from app.modules.auth.dependencies import get_current_user, granted_keys, COOKIE_NAME

router = APIRouter(prefix="/auth", tags=["Auth"])
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # seconds, 7 days

# Off by default so local development over http://localhost keeps working; the
# deploy sets COOKIE_SECURE=true so the session cookie is never sent in clear.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


@router.get("/login-options", response_model=List[schemas.LoginOption])
def login_options(db: Session = Depends(get_db)):
    """Public (pre-auth) endpoint for the login form's user picker. Every other
    user-listing endpoint requires a session; this one intentionally doesn't,
    so it only ever returns id/name for accounts that can actually log in."""
    return (
        db.query(user_models.User)
        .filter(user_models.User.password_hash.isnot(None))
        .filter(user_models.User.is_active.is_(True))
        .all()
    )


@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(user_models.User).filter(user_models.User.name == payload.name).first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid name or password")

    # Deliberately checked after the password: answering "deactivated" to a wrong
    # guess would turn this endpoint into a way to enumerate accounts.
    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="This account has been deactivated. Ask an administrator to restore it.",
        )

    token = create_access_token(user.id, user.name, user.role)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return user


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=schemas.SessionOut)
def me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": current_user.id,
        "name": current_user.name,
        "role": current_user.role,
        "permissions": granted_keys(db, current_user),
    }
