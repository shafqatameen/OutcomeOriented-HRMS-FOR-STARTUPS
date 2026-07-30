from pydantic import BaseModel
from typing import List


class LoginRequest(BaseModel):
    name: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    role: str

    class Config:
        from_attributes = True


class SessionOut(UserOut):
    """/auth/me. Carries the caller's effective permission keys so the UI can hide
    what it must not offer - the API still enforces every one of them."""
    permissions: List[str] = []


class LoginOption(BaseModel):
    """Minimal, pre-auth-safe user info for populating the login form -
    no role or points, unlike UserOut / the full /users list."""
    id: int
    name: str

    class Config:
        from_attributes = True
