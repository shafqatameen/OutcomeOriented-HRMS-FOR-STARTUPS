from typing import Optional

from pydantic import BaseModel


class MailStatus(BaseModel):
    """What the backend thinks its mail settings are.

    Deliberately has no password field of any kind - see core.mail.config_summary.
    """
    configured: bool
    host: Optional[str] = None
    port: int
    username: Optional[str] = None
    from_address: Optional[str] = None
    from_name: str
    has_password: bool
    security: str


class TestMailRequest(BaseModel):
    """Where to send the diagnostic message. Omit to use the caller's own address."""
    to: Optional[str] = None


class TestMailResult(BaseModel):
    sent: bool
    to: str
    detail: str
