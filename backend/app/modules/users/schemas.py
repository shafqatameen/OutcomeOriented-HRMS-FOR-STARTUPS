from pydantic import BaseModel
from typing import List, Optional

class UserBase(BaseModel):
    name: str
    role: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    total_points: int
    #: False means sign-in is blocked. Everything else about the account -
    #: its tasks, its points, its place on the leaderboard - is unaffected.
    is_active: bool

    class Config:
        from_attributes = True


class UserActiveUpdate(BaseModel):
    """Deactivates the account when false, restores it when true."""
    is_active: bool


class UserUpdate(BaseModel):
    """A partial edit: send only the fields that should change.

    Omitting `password` leaves the current one in place, which is what makes a
    plain rename possible without an administrator having to invent a new
    password for somebody else.
    """
    name: Optional[str] = None
    password: Optional[str] = None


class PermissionInfo(BaseModel):
    """One entry from the feature catalogue, for rendering the access panel."""
    key: str
    label: str
    group: str
    description: str


class UserAccess(BaseModel):
    user_id: int
    name: str
    role: str
    #: Admins bypass permission checks, so their grants are informational.
    is_admin: bool
    #: Keys the account can actually exercise (the whole catalogue for admins).
    effective_permissions: List[str]
    #: Rows actually stored for this account.
    granted_permissions: List[str]


class AccessUpdate(BaseModel):
    """Replaces an account's grants with exactly this set."""
    permissions: List[str]
