from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class CalendarChoice(BaseModel):
    """One calendar the connected Google account can write to."""
    id: str
    name: str
    primary: bool = False


class GoogleStatus(BaseModel):
    """Everything the settings dialog needs, in one read.

    `configured` and `connected` are separate answers to separate questions and
    the UI has to distinguish them: the first is about this *installation*
    having OAuth credentials at all, which only whoever runs the server can fix,
    and the second is about this *account* having authorised. Collapsing them
    would show a person a Connect button that cannot work.
    """
    configured: bool
    connected: bool
    google_email: Optional[str] = None
    calendar_id: Optional[str] = None
    calendar_name: Optional[str] = None
    pull_enabled: bool = True
    push_enabled: bool = True
    past_days: int = 0
    future_days: int = 0
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None


class SettingsUpdate(BaseModel):
    """Partial. Absent means leave alone — none of these can be cleared to null."""
    calendar_id: Optional[str] = None
    pull_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    past_days: Optional[int] = None
    future_days: Optional[int] = None


class SyncResult(BaseModel):
    imported: int = 0
    updated_locally: int = 0
    removed_locally: int = 0
    exported: int = 0
    updated_remotely: int = 0
    removed_remotely: int = 0
    #: Per-item problems a sync carried on past. A run can succeed overall and
    #: still have failed to write three events, and saying so is better than a
    #: green tick that hid it.
    errors: List[str] = []
    last_sync_at: Optional[datetime] = None
