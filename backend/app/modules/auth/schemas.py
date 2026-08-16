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


# --- Self-service account lifecycle ------------------------------------------

class SignupRequest(BaseModel):
    """No password field, and that is the design.

    The address is proven before a password exists, so nobody can set one on a
    mailbox they cannot read. `name` is a display name only - the account's
    identity is the address.
    """
    email: str
    name: Optional[str] = None


class EmailRequest(BaseModel):
    """/auth/forgot-password and /auth/resend-verification."""
    email: str


class GenericMessage(BaseModel):
    """The identical answer those two endpoints give for every outcome.

    Typed as its own model rather than a loose dict so that nobody can later add
    a helpful `found: bool` to one call site without noticing they are changing
    the contract every other call site depends on.
    """
    message: str


class TokenCheckRequest(BaseModel):
    token: str
    #: "verify_email" or "password_reset". A link is only good for its own job.
    purpose: str


class TokenCheck(BaseModel):
    valid: bool
    #: Masked (`s••@example.com`), so the page can confirm *which* address this
    #: link belongs to without printing it in full on a possibly shared screen.
    email: Optional[str] = None
    name: Optional[str] = None


class SetPasswordRequest(BaseModel):
    """Used by both /auth/verify and /auth/reset-password.

    The confirmation travels to the server rather than being checked only in the
    browser, so a direct API caller cannot set a password they mistyped.
    """
    token: str
    password: str
    password_confirm: str


class VerifyResult(BaseModel):
    """What happened, and what the person should do next.

    `status` is one of: `pending` (waiting for an administrator), `ready` (sign
    in now), `signed_in` (a session cookie came with this response), or
    `deactivated`. The frontend switches on it; `message` is what it shows.
    """
    status: str
    message: str


class GoogleStart(BaseModel):
    """Where the Google button should send the browser.

    `configured` is false on an installation with no OAuth credentials, so the
    login page can hide the button rather than offering one that leads to
    Google's own error page.
    """
    configured: bool
    authorization_url: Optional[str] = None


class SignupStatus(BaseModel):
    enabled: bool
    #: False when the server has no SMTP settings. The sign-up form cannot work
    #: without mail, so the page needs to know before it renders rather than
    #: after somebody has filled it in.
    mail_ready: bool
