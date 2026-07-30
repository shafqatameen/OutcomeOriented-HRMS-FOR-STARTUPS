from pydantic import BaseModel
from typing import List

class UserBase(BaseModel):
    name: str
    role: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    total_points: int

    class Config:
        from_attributes = True


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
