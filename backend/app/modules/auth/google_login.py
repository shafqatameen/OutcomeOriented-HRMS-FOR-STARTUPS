"""Sign in with Google.

A second, separate OAuth flow from the calendar integration, sharing only the
client credentials. Keeping them apart is the point: signing in asks for
`openid email profile` and nothing else, so nobody is shown a calendar consent
screen for the privilege of logging in - and revoking one does not silently
break the other.

Two rules hold the security of this module up.

**The id_token is only ever believed when this process fetched it itself.** The
claims below are read without verifying the signature, which is safe here and
nowhere else: the token arrived over TLS straight from Google's token endpoint,
in response to a request authenticated with our own client secret, carrying a
one-time code we minted. The channel is the proof. There is deliberately no
endpoint that accepts an id_token from a browser - such a token would be
attacker-supplied and would have to be checked against Google's JWKS first.

**A Google identity is `sub`, not an address.** A Workspace address can be
released and reassigned to a new employee; `sub` never is. Matching on the
address alone would hand a departed colleague's account to their replacement.
"""
import base64
import json
import os
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.emails import InvalidEmail, normalise_email
from app.modules.auth import schemas
from app.modules.auth.dependencies import COOKIE_NAME
from app.modules.auth.registration import _unique_name
from app.modules.auth.security import ALGORITHM, SECRET_KEY, create_access_token
from app.modules.calendar_sync import google
from app.modules.tasks.models import get_ist_now
from app.modules.users import models as user_models

router = APIRouter(prefix="/auth/google", tags=["Auth"])

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7

#: Identity only. Notably absent: every calendar scope. Someone who only wants
#: to sign in should never be asked to hand over their calendar.
SCOPES = ("openid", "email", "profile")

ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

#: Long enough to read a consent screen and pick an account, short enough that a
#: state parameter copied out of a browser history is useless by the time it is.
STATE_TTL = timedelta(minutes=10)


def redirect_uri() -> str:
    """Where Google returns the browser.

    Its own variable rather than the calendar integration's: both must be
    registered on the OAuth client, character for character, and pointing them
    at one endpoint would mean a sign-in code being handed to the calendar
    callback, which would reject it.
    """
    return os.environ.get(
        "GOOGLE_LOGIN_REDIRECT_URI", "http://localhost:8000/auth/google/callback"
    ).strip()


def is_configured() -> bool:
    return bool(google.client_id() and google.client_secret())


# --- The state parameter ------------------------------------------------------

def _issue_state() -> str:
    """A signed, short-lived state. CSRF defence, carrying no identity.

    Unlike the calendar flow's state, this one names nobody: there is no session
    yet, and whose account this becomes is decided entirely by what Google
    returns. Signing it is still what makes the callback refuse a code somebody
    else's browser was tricked into fetching.
    """
    return jwt.encode(
        {
            "purpose": "google_login",
            "exp": datetime.now(timezone.utc) + STATE_TTL,
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _state_ok(state: str) -> bool:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return False
    # Checked explicitly: a session cookie is also a JWT signed with this key,
    # and without this a stolen session token would be accepted as a state.
    return payload.get("purpose") == "google_login"


# --- Reading what Google said -------------------------------------------------

def _claims(id_token: Optional[str]) -> dict:
    """The id_token's payload, with the checks that still matter on a trusted channel.

    Signature verification is skipped for the reason in the module docstring, but
    these three are not signature checks and are not redundant:

      * `aud` must be our client. A token minted for a different application is
        not evidence about a user of this one.
      * `iss` must be Google.
      * `email_verified` must be true. Google will happily assert an unverified
        address on some account types, and treating one as proof would let
        somebody claim a colleague's address by typing it into their own
        profile.
    """
    if not id_token:
        raise HTTPException(status_code=502, detail="Google did not return an identity token.")

    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=502, detail="Google's identity token could not be read.")

    if claims.get("aud") != google.client_id():
        raise HTTPException(status_code=502, detail="Google's identity token was issued to a different application.")

    if claims.get("iss") not in ISSUERS:
        raise HTTPException(status_code=502, detail="Google's identity token came from an unexpected issuer.")

    if claims.get("email_verified") is not True:
        raise HTTPException(
            status_code=403,
            detail="That Google account's email address is not verified, so it cannot be used to sign in.",
        )

    if not claims.get("sub") or not claims.get("email"):
        raise HTTPException(status_code=502, detail="Google's identity token was missing the account id or address.")

    return claims


def _back_to(path: str, **params) -> RedirectResponse:
    """Sends the browser back to the frontend with the outcome in the query.

    A redirect rather than JSON because this endpoint is reached by a browser
    navigation, not by fetch: whatever it returns is what the person is looking
    at, and a page of JSON is not an answer to "did I just sign in?".
    """
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    return RedirectResponse(f"{FRONTEND_ORIGIN}{path}{'?' + query if query else ''}", status_code=302)


# --- Endpoints ----------------------------------------------------------------

@router.get("/start", response_model=schemas.GoogleStart)
def start():
    """Where to send the browser. Reports its own unconfiguredness rather than failing.

    Without this the first symptom of a server with no Google credentials is
    Google's own error page, which tells whoever clicked nothing they can act on.
    """
    if not is_configured():
        return {"configured": False, "authorization_url": None}

    query = {
        "client_id": google.client_id(),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # No access_type=offline and no prompt=consent, both of which the
        # calendar flow needs. There is nothing to do on this person's behalf
        # later, so asking for a refresh token would be requesting a durable
        # credential with no use for it.
        "state": _issue_state(),
    }
    return {
        "configured": True,
        "authorization_url": f"{google.AUTH_ENDPOINT}?{urllib.parse.urlencode(query)}",
    }


@router.get("/callback")
def callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Turns Google's code into a session, or into a new pending account.

    Every failure path here lands the person back on a page with a message.
    Raising a 502 into a browser navigation would show them a JSON body, which
    is the one outcome that leaves somebody with nowhere to click.
    """
    if error:
        # Most often access_denied - they pressed Cancel, which is not an error
        # worth alarming anybody about.
        return _back_to("/login", google_error="cancelled")

    if not code or not state or not _state_ok(state):
        return _back_to("/login", google_error="expired")

    if not is_configured():
        return _back_to("/login", google_error="unconfigured")

    try:
        # The sign-in callback, not the calendar one: Google checks the redirect
        # here against the value the code was issued for.
        response = google.exchange_code(code, redirect_uri())
    except google.GoogleError:
        return _back_to("/login", google_error="exchange_failed")

    try:
        claims = _claims(response.get("id_token"))
    except HTTPException:
        return _back_to("/login", google_error="identity_rejected")

    try:
        email = normalise_email(claims["email"])
    except InvalidEmail:
        return _back_to("/login", google_error="identity_rejected")

    sub = claims["sub"]
    now = get_ist_now()

    user = db.query(user_models.User).filter(user_models.User.google_sub == sub).first()

    if user is None:
        # No account carries this Google identity yet. An address match links
        # the two - the person signed up with a password first and is now using
        # the Google button, which is the same person by the only evidence
        # available and by the only evidence they could offer either way.
        user = db.query(user_models.User).filter(user_models.User.email == email).first()

        if user is not None:
            user.google_sub = sub
        else:
            user = user_models.User(
                name=_unique_name(db, claims.get("name") or email.partition("@")[0]),
                email=email,
                role="Member",
                total_points=0,
                password_hash=None,
                google_sub=sub,
                # Google has already proved the address, so there is no
                # verification link to send. Approval is still required: proving
                # who you are is not the same as being let in.
                email_verified_at=now,
                approved_at=None,
                is_active=False,
            )
            db.add(user)

    # Signing in with Google proves the address however the account was created,
    # including one an administrator typed and never mailed.
    if user.email_verified_at is None:
        user.email_verified_at = now

    db.commit()
    db.refresh(user)

    if user.approved_at is None:
        return _back_to("/pending")
    if not user.is_active:
        return _back_to("/login", google_error="deactivated")

    token = create_access_token(user.id, user.name, user.role)
    redirect = _back_to("/admin" if user.role == "Admin" else "/")
    redirect.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return redirect
