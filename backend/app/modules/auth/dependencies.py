from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.modules.users import models as user_models
from app.modules.auth.permissions import PERMISSION_KEYS
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


def granted_keys(db: Session, user) -> list:
    """Every permission key this account can exercise.

    The Admin role is a superuser bypass, so it reports the whole catalogue
    regardless of what rows exist. That is what makes it impossible for an
    administrator to revoke their own access to the access panel.
    """
    if user.role == "Admin":
        return sorted(PERMISSION_KEYS)
    rows = (
        db.query(user_models.UserPermission.permission_key)
        .filter(user_models.UserPermission.user_id == user.id)
        .all()
    )
    return sorted(row[0] for row in rows)


def require_permission(permission_key: str):
    """Dependency factory gating an endpoint on one permission key.

    Enforced here, in the API, because hiding a control in the UI is presentation
    and not access control.
    """
    if permission_key not in PERMISSION_KEYS:
        raise ValueError(f"Unknown permission key: {permission_key}")

    def dependency(current_user=Depends(require_user), db: Session = Depends(get_db)):
        if current_user.role == "Admin":
            return current_user

        has_it = (
            db.query(user_models.UserPermission.id)
            .filter(
                user_models.UserPermission.user_id == current_user.id,
                user_models.UserPermission.permission_key == permission_key,
            )
            .first()
        )
        if not has_it:
            raise HTTPException(
                status_code=403,
                detail=f"Your account does not have access to this feature ({permission_key})",
            )
        return current_user

    return dependency
