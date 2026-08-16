from pydantic import BaseModel
from typing import List, Optional

class UserBase(BaseModel):
    name: str
    role: str

class UserCreate(UserBase):
    password: str
    #: The address this person signs in with. Optional only so that scripted
    #: callers predating email sign-in keep working; the admin form requires it.
    email: Optional[str] = None

class User(UserBase):
    id: int
    total_points: int
    #: Null on accounts that predate email sign-in. Those still sign in by name
    #: until an address is set - the admin list flags them for exactly that.
    email: Optional[str] = None
    #: False means sign-in is blocked. Everything else about the account -
    #: its tasks, its points, its place on the leaderboard - is unaffected.
    is_active: bool
    #: The function this person is meant to be working in. None is normal.
    home_function_id: Optional[int] = None

    class Config:
        from_attributes = True


class PendingUser(BaseModel):
    """One account waiting for approval, for the admin queue.

    Deliberately not the full `User`: nothing here has points, a seat or
    permissions yet, and showing those columns as zeroes invites an
    administrator to read them as facts about a person rather than as the
    absence of an account.
    """
    id: int
    name: str
    #: Always present in this queue - an account with no address cannot have
    #: verified one, and only verified accounts are listed.
    email: Optional[str] = None
    role: str

    class Config:
        from_attributes = True


class UserActiveUpdate(BaseModel):
    """Deactivates the account when false, restores it when true."""
    is_active: bool


class SeatUpdate(BaseModel):
    """Sets the fixed place. An explicit null clears it."""
    home_function_id: Optional[int] = None


class UserUpdate(BaseModel):
    """A partial edit: send only the fields that should change.

    Omitting `password` leaves the current one in place, which is what makes a
    plain rename possible without an administrator having to invent a new
    password for somebody else.
    """
    name: Optional[str] = None
    password: Optional[str] = None
    #: Setting this is what moves an account onto email sign-in. There is no way
    #: to clear it back to null: that would silently hand the account back to the
    #: legacy name fallback, which is a downgrade nobody would mean to request.
    email: Optional[str] = None


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
