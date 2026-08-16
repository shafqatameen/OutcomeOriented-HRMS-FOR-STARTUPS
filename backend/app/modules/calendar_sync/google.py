"""Google's OAuth and Calendar endpoints, over the wire and nothing else.

No database, no cards, no session — this module turns arguments into HTTPS
requests and JSON into dicts. Everything that decides *what* to sync lives in
sync.py, and everything about who may ask lives in router.py. Keeping the wire
alone in here is what makes the rest testable without a network and makes a
Google outage legible: a failure raised from this file is Google's, a failure
raised from sync.py is ours.

**Why urllib and not a client library.** The whole surface used here is four
REST calls and two form posts. `google-api-python-client` brings a discovery
layer, its own auth stack and a long dependency tail to wrap them, and this
backend's requirements.txt is nine lines on purpose — the deploy scripts install
it on a shared aaPanel host where every added dependency is another thing that
can fail to build. The standard library covers this exactly, and the code below
is shorter than the configuration the library would need.

Blocking I/O is deliberate too: every endpoint in this app is a plain `def`, so
FastAPI already runs them in a threadpool and a blocking socket costs a pooled
thread rather than the event loop.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pytz

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
API_ROOT = "https://www.googleapis.com/calendar/v3"

#: Least privilege, one line at a time:
#:
#:   calendar.events              read and write events. The whole job.
#:   calendar.calendarlist.readonly   name the calendars, so the settings dialog
#:                                can offer a choice instead of assuming primary.
#:   openid, email                identify *which* Google account was connected.
#:                                Worth a scope because connecting the personal
#:                                account when you meant the work one is the
#:                                mistake people make, and it is invisible
#:                                otherwise.
#:
#: Notably absent: `calendar`, the full-access scope. It would additionally allow
#: creating and deleting whole calendars, which nothing here does.
SCOPES = (
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "openid",
    "email",
)

#: Seconds to wait on Google. Short enough that a hung sync fails inside one
#: request rather than holding a worker thread until the proxy gives up.
TIMEOUT_SECONDS = 20

#: Refresh this long before the access token actually expires, so a sync that
#: takes a while cannot have its token die mid-run.
EXPIRY_MARGIN_SECONDS = 120

IST = pytz.timezone("Asia/Kolkata")


class GoogleError(Exception):
    """A call to Google that did not succeed, with its reason kept readable."""

    def __init__(self, message: str, status: Optional[int] = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        #: True for 429 and 5xx — the caller may sensibly try again later, which
        #: is a different sentence to show a user than "your token was revoked".
        self.retryable = retryable


# --- Configuration -----------------------------------------------------------

def client_id() -> str:
    return os.environ.get("GOOGLE_CLIENT_ID", "").strip()


def client_secret() -> str:
    return os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()


def redirect_uri() -> str:
    """Where Google sends the browser back to.

    Must match a redirect URI registered on the Google Cloud OAuth client
    *character for character* — Google compares the string, not the URL. The
    default is the local backend, which is what a developer needs and what a
    deployment must override.
    """
    return os.environ.get(
        "GOOGLE_REDIRECT_URI", "http://localhost:8000/integrations/google/callback"
    ).strip()


def is_configured() -> bool:
    """Whether this installation has OAuth credentials at all.

    Asked before every flow so the UI can explain what is missing. Without this
    the first symptom of an unconfigured server is Google's own error page,
    which tells the person who clicked nothing they can act on.
    """
    return bool(client_id() and client_secret())


# --- Time --------------------------------------------------------------------
#
# The app stores naive IST wall-clock throughout (see modules/tasks/models.py and
# the frontend's lib/board.ts, which pin +05:30 on the way in). Google speaks
# RFC 3339 with an offset. These two functions are the whole border between them,
# and every conversion in this module goes through them so the offset is applied
# in exactly one place.

def to_rfc3339(at: datetime) -> str:
    """A stored IST datetime as an offset-qualified timestamp Google accepts."""
    if at.tzinfo is not None:
        return at.astimezone(IST).isoformat()
    return IST.localize(at).isoformat()


def from_rfc3339(text: str) -> datetime:
    """A Google timestamp as naive IST, the form every column here stores."""
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(IST).replace(tzinfo=None)


# --- Transport ---------------------------------------------------------------

def _send(request: urllib.request.Request) -> Dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise GoogleError(
            _describe(error),
            status=error.code,
            retryable=error.code == 429 or error.code >= 500,
        ) from error
    except urllib.error.URLError as error:
        # DNS, TLS, refused connection — the request never reached Google, so it
        # is always worth retrying and never a sign the grant is bad.
        raise GoogleError(f"Could not reach Google: {error.reason}", retryable=True) from error

    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def _describe(error: urllib.error.HTTPError) -> str:
    """Google's own explanation, when it sent one worth repeating.

    Its error bodies are genuinely informative — "Invalid Credentials", "Not
    Found: calendarId" — and surfacing them saves an otherwise blind debugging
    session against somebody else's server.
    """
    try:
        payload = json.loads(error.read().decode("utf-8"))
    except Exception:
        return f"Google returned HTTP {error.code}"

    detail = payload.get("error")
    if isinstance(detail, dict):
        message = detail.get("message") or detail.get("status")
        if message:
            return f"Google: {message}"
    if isinstance(detail, str):
        described = payload.get("error_description")
        return f"Google: {described or detail}"
    return f"Google returned HTTP {error.code}"


def _form_post(url: str, fields: Dict[str, str]) -> Dict[str, Any]:
    data = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return _send(request)


def _api(
    method: str,
    path: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    url = f"{API_ROOT}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    return _send(request)


# --- OAuth -------------------------------------------------------------------

def authorization_url(state: str) -> str:
    """Where to send the browser to ask this person for consent.

    `access_type=offline` with `prompt=consent` is the combination that matters:
    offline is what makes Google issue a refresh token at all, and consent is
    what makes it issue one *again* on a repeat authorisation. Without the
    second, reconnecting an already-connected account returns an access token
    and no refresh token, and the link stops working an hour later with nothing
    in any log to explain why.
    """
    query = {
        "client_id": client_id(),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_ENDPOINT}?{urllib.parse.urlencode(query)}"


def exchange_code(code: str) -> Dict[str, Any]:
    """Turns the one-time code from the callback into tokens."""
    return _form_post(
        TOKEN_ENDPOINT,
        {
            "code": code,
            "client_id": client_id(),
            "client_secret": client_secret(),
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        },
    )


def refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    """A fresh access token. The response carries no new refresh token."""
    return _form_post(
        TOKEN_ENDPOINT,
        {
            "refresh_token": refresh_token,
            "client_id": client_id(),
            "client_secret": client_secret(),
            "grant_type": "refresh_token",
        },
    )


def revoke(token: str) -> None:
    """Tells Google to invalidate a grant. Best effort by design.

    Disconnecting must succeed locally whether or not this call does: a token
    Google has already expired answers 400 here, and refusing to delete our own
    row over that would leave a person unable to disconnect an account that is
    already dead.
    """
    try:
        _form_post(REVOKE_ENDPOINT, {"token": token})
    except GoogleError:
        pass


def email_from_id_token(id_token: Optional[str]) -> Optional[str]:
    """The address inside the id_token, read without verifying the signature.

    Unverified is correct *here* and nowhere else: this token was just received
    over TLS directly from Google's token endpoint in response to our own
    client-secret-authenticated request, so its provenance is already
    established by the channel. The value is used as a label on screen and
    grants nothing. An id_token arriving by any other route would have to be
    verified against Google's JWKS before being believed.
    """
    if not id_token:
        return None
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        import base64

        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except Exception:
        return None
    email = claims.get("email")
    return email if isinstance(email, str) else None


def expiry_from(response: Dict[str, Any], now: datetime) -> Optional[datetime]:
    """When the access token in `response` stops working, as naive IST."""
    seconds = response.get("expires_in")
    if not isinstance(seconds, (int, float)):
        return None
    base = now.replace(tzinfo=None) if now.tzinfo else now
    return base + timedelta(seconds=int(seconds))


def is_expired(expires_at: Optional[datetime], now: datetime) -> bool:
    if expires_at is None:
        return True
    reference = now.replace(tzinfo=None) if now.tzinfo else now
    return expires_at <= reference + timedelta(seconds=EXPIRY_MARGIN_SECONDS)


# --- Calendar ----------------------------------------------------------------

def list_calendars(access_token: str) -> List[Dict[str, Any]]:
    """Every calendar this account can see, for the settings dialog's picker."""
    payload = _api(
        "GET",
        "/users/me/calendarList",
        access_token,
        params={"minAccessRole": "writer", "showHidden": "false"},
    )
    return payload.get("items", []) or []


def list_events(
    access_token: str,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
    page_limit: int = 20,
) -> List[Dict[str, Any]]:
    """Events in a window, recurrences already expanded.

    `singleEvents=true` is what does that expansion: without it a weekly meeting
    arrives as one row with a recurrence rule to interpret ourselves, and a card
    cannot be placed on a day grid from a rule. With it, each occurrence is its
    own event with its own id — which is exactly the granularity a card needs,
    since moving next Tuesday's stand-up must not move every other one.

    `showDeleted=true` because a cancelled occurrence is information: it is how
    we learn to take a card off the board. Those arrive with `status:
    "cancelled"` and no times.

    Paging is bounded rather than open — a window widened to a year against a
    busy calendar could otherwise walk pages until the request times out.
    """
    params = {
        "timeMin": to_rfc3339(time_min),
        "timeMax": to_rfc3339(time_max),
        "singleEvents": "true",
        "orderBy": "startTime",
        "showDeleted": "true",
        "maxResults": 250,
    }
    events: List[Dict[str, Any]] = []
    page_token: Optional[str] = None

    for _ in range(page_limit):
        if page_token:
            params["pageToken"] = page_token
        payload = _api("GET", f"/calendars/{urllib.parse.quote(calendar_id)}/events",
                       access_token, params=params)
        events.extend(payload.get("items", []) or [])
        page_token = payload.get("nextPageToken")
        if not page_token:
            break

    return events


def insert_event(access_token: str, calendar_id: str, event: Dict[str, Any]) -> Dict[str, Any]:
    return _api("POST", f"/calendars/{urllib.parse.quote(calendar_id)}/events",
                access_token, body=event)


def patch_event(
    access_token: str, calendar_id: str, event_id: str, event: Dict[str, Any]
) -> Dict[str, Any]:
    """PATCH rather than PUT: an update must not blank fields we never send.

    A card knows about a title, a description and two times. An event may also
    carry attendees, a conferencing link, a room booking and a reminder set,
    none of which this app models. PUT would replace the event with our partial
    view of it and silently drop all of that.
    """
    return _api(
        "PATCH",
        f"/calendars/{urllib.parse.quote(calendar_id)}/events/{urllib.parse.quote(event_id)}",
        access_token,
        body=event,
    )


def delete_event(access_token: str, calendar_id: str, event_id: str) -> None:
    """Removes an event. A 404 or 410 is success — it is already not there."""
    try:
        _api(
            "DELETE",
            f"/calendars/{urllib.parse.quote(calendar_id)}/events/{urllib.parse.quote(event_id)}",
            access_token,
        )
    except GoogleError as error:
        if error.status not in (404, 410):
            raise


# --- Event shape -------------------------------------------------------------

def event_times(event: Dict[str, Any]) -> Optional[Tuple[datetime, datetime, bool]]:
    """`(start, end, is_all_day)` in naive IST, or None if this is not placeable.

    Google expresses the two kinds of event differently and the difference is
    load-bearing: a timed event carries `dateTime` with an offset, an all-day
    event carries `date` and no time at all. An all-day event is widened to the
    whole IST day so it can be drawn on an hour grid, because the alternative —
    dropping it — would hide exactly the entries people most need to plan
    around, the day off and the flight.
    """
    start, end = event.get("start") or {}, event.get("end") or {}

    if start.get("dateTime"):
        opens = from_rfc3339(start["dateTime"])
        closes = from_rfc3339(end["dateTime"]) if end.get("dateTime") else opens
        return opens, closes, False

    if start.get("date"):
        opens = datetime.fromisoformat(start["date"])
        # Google's all-day end date is exclusive: a single day ends on the
        # following morning. Backing off a second keeps the block inside the day
        # it belongs to instead of bleeding a pixel into the next column.
        closes = (
            datetime.fromisoformat(end["date"]) - timedelta(seconds=1)
            if end.get("date")
            else opens + timedelta(days=1) - timedelta(seconds=1)
        )
        return opens, closes, True

    return None


def event_body(title: str, description: Optional[str], start: datetime, end: datetime) -> Dict[str, Any]:
    """The event payload for a card. Always timed — a card has a clock on it."""
    return {
        "summary": title,
        "description": description or "",
        "start": {"dateTime": to_rfc3339(start), "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": to_rfc3339(end), "timeZone": "Asia/Kolkata"},
    }
