from datetime import datetime

from pydantic import BaseModel


class InboxItemCreate(BaseModel):
    """One capture.

    Just the text. There is no owner field on purpose - the router takes that
    from the session, so this schema offers no way to write into somebody
    else's inbox even if a caller tried.
    """
    body: str


class InboxItem(BaseModel):
    id: int
    body: str
    created_at: datetime

    class Config:
        from_attributes = True


class InboxCount(BaseModel):
    """How many items are waiting to be clarified.

    Its own endpoint because the navigation rail wants the number on every page
    without pulling everybody's captured text into a layout that renders app-wide.
    """
    count: int
