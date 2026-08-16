from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


# --- Someday / Maybe ---------------------------------------------------------

class SomedayCreate(BaseModel):
    title: str
    notes: Optional[str] = None


class SomedayUpdate(BaseModel):
    """A rename, a note edit, or a "I have looked at this again" stamp.

    `reviewed` is a flag rather than a timestamp so a caller cannot backdate it;
    the server writes the time it actually happened.
    """
    title: Optional[str] = None
    notes: Optional[str] = None
    reviewed: Optional[bool] = None


class SomedayItem(BaseModel):
    id: int
    title: str
    notes: Optional[str] = None
    created_at: datetime
    last_reviewed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Reference ---------------------------------------------------------------

class ReferenceCreate(BaseModel):
    title: str
    body: str


class ReferenceUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None


class ReferenceItem(BaseModel):
    id: int
    title: str
    body: str
    created_at: datetime

    class Config:
        from_attributes = True


# --- Waiting / Delegate ------------------------------------------------------

class WaitingCreate(BaseModel):
    """A delegate is required, as either an account or a bare name.

    Both are offered because plenty of what you wait on is owed by someone who
    will never hold a login here. Supplying neither is refused by the router -
    a waiting item with nobody to wait on is not a waiting item.
    """
    title: str
    notes: Optional[str] = None
    delegate_user_id: Optional[int] = None
    delegate_name: Optional[str] = None
    follow_up_date: Optional[date] = None


class WaitingUpdate(BaseModel):
    """Everything editable except `waiting_since`, which is history.

    Sending `status: "Closed"` is how an item leaves the list. Reopening is
    allowed - things arrive and then turn out to be incomplete.
    """
    title: Optional[str] = None
    notes: Optional[str] = None
    follow_up_date: Optional[date] = None
    status: Optional[Literal["Open", "Closed"]] = None


class WaitingItem(BaseModel):
    id: int
    title: str
    notes: Optional[str] = None
    delegate_user_id: Optional[int] = None
    delegate_name: str
    waiting_since: datetime
    follow_up_date: Optional[date] = None
    status: str
    closed_at: Optional[datetime] = None
    #: Whole days outstanding. Computed rather than stored so it cannot go stale,
    #: and served from the API so the list and any future reminder agree on it.
    days_waiting: int
    #: Whether the follow-up date has arrived. The one thing this list nags about.
    is_due: bool

    class Config:
        from_attributes = True
