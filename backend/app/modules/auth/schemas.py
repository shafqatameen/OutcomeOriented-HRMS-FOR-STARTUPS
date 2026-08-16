from pydantic import BaseModel
from typing import List, Optional


class LoginRequest(BaseModel):
    """Credentials for /auth/login.

    `email` is the identifier. It also accepts a display name, but only for
    accounts that have no address set yet - the transitional path described in
    migration c2f8b1d40a37 and implemented in this module's `find_account`.
    Once every account has an address that fallback matches nothing and the
    field means exactly what it is called.
    """
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    role: str
    #: Null on accounts that predate email sign-in and have not been given one.
    email: Optional[str] = None

    class Config:
        from_attributes = True


class SessionOut(UserOut):
    """/auth/me. Carries the caller's effective permission keys so the UI can hide
    what it must not offer - the API still enforces every one of them."""
    permissions: List[str] = []
