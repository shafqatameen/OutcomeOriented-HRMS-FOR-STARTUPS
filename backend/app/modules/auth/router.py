import os
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.emails import InvalidEmail, normalise_email
from app.modules.users import models as user_models
from app.modules.auth import schemas
from app.modules.auth.security import DUMMY_PASSWORD_HASH, verify_password, create_access_token
from app.modules.auth.dependencies import get_current_user, granted_keys, COOKIE_NAME

router = APIRouter(prefix="/auth", tags=["Auth"])
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # seconds, 7 days

# Off by default so local development over http://localhost keeps working; the
# deploy sets COOKIE_SECURE=true so the session cookie is never sent in clear.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def find_account(db: Session, identifier: str):
    """Resolves what somebody typed into the sign-in box to one account, or None.

    Email is the identifier. The name lookup underneath it is a migration
    ramp, not a second way in: it only ever matches an account whose `email` is
    still null, so giving an account an address is what switches it over, one
    account at a time, with no flag day and nobody locked out. When the last
    address is filled in the fallback stops matching anything on its own.

    Names are matched case-insensitively here because people now type them
    instead of picking them off a list. That is not a widening: the name column
    is unique, so at most one row can match either way.
    """
    try:
        email = normalise_email(identifier)
    except InvalidEmail:
        email = None

    if email:
        found = db.query(user_models.User).filter(user_models.User.email == email).first()
        if found:
            return found

    name = (identifier or "").strip()
    if not name:
        return None

    return (
        db.query(user_models.User)
        .filter(func.lower(user_models.User.name) == name.lower())
        .filter(user_models.User.email.is_(None))
        .first()
    )


@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = find_account(db, payload.email)

    # Hashed even when there is no account to check against. bcrypt is slow by
    # design, so returning early on an unknown address would make "no such
    # account" measurably faster than "wrong password" - the same enumeration
    # this endpoint is careful about below, just read off a stopwatch instead of
    # the response body.
    stored_hash = user.password_hash if user and user.password_hash else DUMMY_PASSWORD_HASH
    password_ok = verify_password(payload.password, stored_hash)

    if not user or not user.password_hash or not password_ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Everything below is checked *after* the password, and only ever reached by
    # somebody who has already proved they own the account. Answering any of it
    # to a wrong guess would turn this endpoint into a way to enumerate accounts
    # and read off their state.
    #
    # The order matters: an account can be unverified, unapproved and inactive
    # all at once, and the first of those is the one they can actually do
    # something about.

    if user.email and user.email_verified_at is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "Confirm your email address first - check your inbox for the link "
                "we sent, or ask for a new one."
            ),
        )

    if user.approved_at is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "Your account is waiting for an administrator to approve it. "
                "You will get an email when it is ready."
            ),
        )

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
        "email": current_user.email,
        "permissions": granted_keys(db, current_user),
    }
