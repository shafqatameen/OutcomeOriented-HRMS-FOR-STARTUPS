"""The Google Calendar API.

Two rules, stated once here rather than in every docstring below.

**No endpoint takes a user id.** Every one of them resolves the connection from
the caller's own session, exactly as the board and inbox routers do. That is the
entire access-control story for this module, and it is deliberately not
expressible any other way: there is no route that could be made to read somebody
else's calendar by guessing an integer, because there is nowhere to put the
integer.

**The callback is a browser navigation, not an API call.** It is the only
endpoint here that answers with a redirect instead of JSON, because Google sends
a person's browser to it. A failure therefore has to come back as a page the
person is looking at, which is why every error path below ends in a redirect
carrying a reason rather than an HTTPException nobody would ever see.
"""
import os
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tokenstore import decrypt
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.auth.security import ALGORITHM, SECRET_KEY
from app.modules.boards.router import personal_board
from app.modules.calendar_sync import credentials, google, models, schemas, sync

router = APIRouter(prefix="/integrations/google", tags=["Google Calendar"])

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")

#: Where the callback sends the browser once it is done, good news or bad.
#: MyUniverse rather than a settings page because that is where the calendar is
#: looked at, and landing back on it means the result of connecting is visible
#: immediately rather than described.
RETURN_PATH = "/universe"

#: How long an authorisation may sit half-finished. Ten minutes is enough to
#: read a consent screen and pick an account, and short enough that a state
#: parameter left in a browser history is not a usable thing to replay.
STATE_TTL_SECONDS = 600
STATE_PURPOSE = "google-calendar-connect"


# --- The state parameter -----------------------------------------------------

def _issue_state(user_id: int) -> str:
    """A signed, expiring token naming who started this authorisation.

    Signed with the session key rather than stored in a table, because the only
    thing it has to survive is a round trip through Google — a row would be
    server state with a lifetime of ninety seconds and a cleanup job to write.

    Its job is CSRF defence: without a state Google can verify came from us, an
    attacker can hand somebody a crafted authorisation link and have the
    callback attach *the attacker's* calendar to the victim's account, which
    then quietly publishes everything the victim schedules. The `purpose` claim
    keeps this token from being usable anywhere a session token is expected,
    since both are signed with the same key.
    """
    return jwt.encode(
        {
            "sub": str(user_id),
            "purpose": STATE_PURPOSE,
            "exp": datetime.now(timezone.utc) + timedelta(seconds=STATE_TTL_SECONDS),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _read_state(state: str) -> Optional[int]:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != STATE_PURPOSE:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None


def _return_to(outcome: str, reason: Optional[str] = None) -> RedirectResponse:
    query = {"google": outcome}
    if reason:
        # Truncated because it is going into a URL a browser will show, and
        # Google's longer error bodies would fill the address bar.
        query["reason"] = reason[:200]
    return RedirectResponse(
        f"{FRONTEND_ORIGIN}{RETURN_PATH}?{urllib.parse.urlencode(query)}",
        status_code=303,
    )


# --- Lookups -----------------------------------------------------------------

def _account_of(db: Session, user) -> Optional[models.GoogleAccount]:
    return (
        db.query(models.GoogleAccount)
        .filter(models.GoogleAccount.user_id == user.id)
        .first()
    )


def _require_account(db: Session, user) -> models.GoogleAccount:
    account = _account_of(db, user)
    if account is None:
        raise HTTPException(status_code=404, detail="No Google Calendar is connected.")
    return account


def _is_connected(account: Optional[models.GoogleAccount]) -> bool:
    """Connected means *usable*, not merely present.

    A row whose refresh token will not decrypt — the state JWT_SECRET_KEY
    rotation leaves behind — is a row that can never talk to Google again.
    Reporting it as connected would show a working integration whose every sync
    fails, so it is reported the way it will behave: disconnected, reconnect.
    """
    return account is not None and decrypt(account.refresh_token) is not None


def _status(account: Optional[models.GoogleAccount]) -> schemas.GoogleStatus:
    if not _is_connected(account):
        return schemas.GoogleStatus(
            configured=google.is_configured(),
            connected=False,
            past_days=models.DEFAULT_PAST_DAYS,
            future_days=models.DEFAULT_FUTURE_DAYS,
            last_sync_error=(account.last_sync_error if account else None),
        )
    return schemas.GoogleStatus(
        configured=google.is_configured(),
        connected=True,
        google_email=account.google_email,
        calendar_id=account.calendar_id,
        calendar_name=account.calendar_name,
        pull_enabled=account.pull_enabled,
        push_enabled=account.push_enabled,
        past_days=account.past_days,
        future_days=account.future_days,
        last_sync_at=account.last_sync_at,
        last_sync_error=account.last_sync_error,
    )


def _as_http(error: Exception) -> HTTPException:
    """Turns a sync failure into the status code that describes it honestly.

    409 for a dead grant, because it is the client's state that is wrong and the
    fix is an action only its owner can take — reconnect. 503 for a Google
    outage or a timeout, because nothing is wrong here and trying again later is
    the correct advice. Collapsing both into 500 would tell a person to call
    support over a two-minute Google blip.
    """
    if isinstance(error, credentials.NotConnected):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, google.GoogleError):
        return HTTPException(
            status_code=503 if error.retryable else 502, detail=str(error)
        )
    return HTTPException(status_code=500, detail="The calendar sync failed.")


# --- Status and settings -----------------------------------------------------

@router.get("/status", response_model=schemas.GoogleStatus)
def read_status(
    db: Session = Depends(get_db),
    user=Depends(require_permission("calendar.sync")),
):
    """Whether this account has a working calendar link, and how it is set up."""
    return _status(_account_of(db, user))


@router.get("/calendars", response_model=list[schemas.CalendarChoice])
def read_calendars(
    db: Session = Depends(get_db),
    user=Depends(require_permission("calendar.sync")),
):
    """The connected account's writable calendars, for the picker.

    Filtered to writable in google.list_calendars: offering a calendar that can
    only be read would let somebody choose a destination every push then fails
    against, and the failure would arrive later and elsewhere.
    """
    account = _require_account(db, user)
    try:
        token = credentials.access_token_for(db, account)
        items = google.list_calendars(token)
    except (credentials.NotConnected, google.GoogleError) as error:
        raise _as_http(error) from error

    choices = [
        {
            "id": item.get("id", ""),
            "name": item.get("summaryOverride") or item.get("summary") or item.get("id", ""),
            "primary": bool(item.get("primary")),
        }
        for item in items
        if item.get("id")
    ]

    # Learn the selected calendar's name while the list is in hand. It is only a
    # label, but it is the one shown wherever the picker cannot be filled — and
    # this is the only moment the names are known without spending a second
    # request on a settings save that has no other reason to call Google.
    chosen = next((choice for choice in choices if choice["id"] == account.calendar_id), None)
    if chosen and account.calendar_name != chosen["name"]:
        account.calendar_name = chosen["name"]
        db.commit()

    return choices


@router.patch("/settings", response_model=schemas.GoogleStatus)
def update_settings(
    payload: schemas.SettingsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("calendar.sync")),
):
    """Changes which calendar is synced, in which directions, over what window."""
    account = _require_account(db, user)
    fields = payload.model_fields_set

    if "calendar_id" in fields and payload.calendar_id:
        chosen = payload.calendar_id.strip()
        if chosen != account.calendar_id:
            # The previous calendar's events are no longer this board's
            # business, and their ids certainly are not: leaving the links in
            # place would have the next sync patch events on a calendar the
            # owner has just switched away from. Cleared rather than followed.
            account.calendar_id = chosen
            account.calendar_name = None
            account.last_sync_at = None
            _clear_links(db, user)

    if "pull_enabled" in fields and payload.pull_enabled is not None:
        account.pull_enabled = payload.pull_enabled
    if "push_enabled" in fields and payload.push_enabled is not None:
        account.push_enabled = payload.push_enabled
    if "past_days" in fields and payload.past_days is not None:
        account.past_days = max(0, min(models.MAX_PAST_DAYS, payload.past_days))
    if "future_days" in fields and payload.future_days is not None:
        account.future_days = max(1, min(models.MAX_FUTURE_DAYS, payload.future_days))

    db.commit()
    db.refresh(account)
    return _status(account)


def _clear_links(db: Session, user) -> None:
    """Forgets every card↔event mapping on this account's own board.

    Used when the destination calendar changes and when the connection is
    dropped. The cards stay — they are the owner's work, and a disconnected
    calendar is no reason to delete their week — but they stop claiming to be
    events on a calendar this app is no longer looking at.
    """
    from app.modules.boards import models as board_models

    board = personal_board(db, user)
    list_ids = [lst.id for lst in board.lists]
    if not list_ids:
        return
    (
        db.query(board_models.Card)
        .filter(
            board_models.Card.list_id.in_(list_ids),
            board_models.Card.google_event_id.isnot(None),
        )
        .update({"google_event_id": None}, synchronize_session=False)
    )


# --- Connecting --------------------------------------------------------------

@router.get("/authorize")
def start_authorization(user=Depends(require_permission("calendar.sync"))):
    """The URL to send this person to for consent.

    Returned as JSON for the client to navigate to, rather than answered as a
    redirect. A redirect would be followed by `fetch` transparently and land the
    consent page inside an XHR that cannot render it — the browser has to go
    there itself, as a top-level navigation.
    """
    if not google.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "This server has no Google OAuth credentials. Set GOOGLE_CLIENT_ID "
                "and GOOGLE_CLIENT_SECRET in the backend environment."
            ),
        )
    return {"authorization_url": google.authorization_url(_issue_state(user.id))}


@router.get("/callback")
def finish_authorization(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Where Google returns the browser. Always answers with a redirect.

    Both halves of the identity check matter and neither is redundant. The state
    proves this authorisation was started by us and names who started it. The
    session cookie proves who is sitting at the browser now. Requiring them to
    agree is what stops a crafted link from attaching one person's calendar to
    another person's account — the attack the state parameter exists for, which
    a state check alone only half prevents.

    The session cookie arrives here at all because it is SameSite=Lax and this
    is a top-level GET navigation. Were it ever tightened to Strict, this
    endpoint would stop seeing a user and every connection would fail closed —
    which is the safe direction, but worth knowing before changing it.
    """
    if error:
        # The person pressed Cancel on the consent screen, most often.
        return _return_to("denied", error)
    if not code or not state:
        return _return_to("error", "Google did not send an authorisation code.")

    state_user_id = _read_state(state)
    if state_user_id is None:
        return _return_to("error", "That authorisation link has expired. Try again.")
    if user is None:
        return _return_to("error", "Your session ended while Google was asking. Sign in and retry.")
    if user.id != state_user_id:
        return _return_to("error", "That authorisation was started by a different account.")

    try:
        tokens = google.exchange_code(code)
    except google.GoogleError as exchange_error:
        return _return_to("error", str(exchange_error))

    if not tokens.get("refresh_token"):
        # Without one, the link works for an hour and then dies with no way back
        # except re-consent — so this is refused up front rather than stored and
        # discovered later. `prompt=consent` on the authorization URL is what
        # normally prevents it; reaching here usually means that was overridden.
        return _return_to(
            "error",
            "Google did not issue a refresh token. Remove this app's access at "
            "myaccount.google.com/permissions and connect again.",
        )

    account = _account_of(db, user)
    if account is None:
        account = models.GoogleAccount(user_id=user.id)
        db.add(account)

    credentials.store_tokens(account, tokens)
    account.google_email = google.email_from_id_token(tokens.get("id_token")) or account.google_email
    account.last_sync_error = None
    # A reconnection may be to a different Google account entirely, and the old
    # account's event ids mean nothing on the new one.
    account.last_sync_at = None
    _clear_links(db, user)
    db.commit()

    return _return_to("connected")


@router.delete("/connection", status_code=200)
def disconnect(
    db: Session = Depends(get_db),
    user=Depends(require_permission("calendar.sync")),
):
    """Drops the connection and tells Google to forget the grant.

    Revoking at Google is the part people actually mean by "disconnect" — a row
    deleted here while the grant lives on in their Google account is a token
    still outstanding somewhere. It is best effort, though, and a failure there
    must not block the local delete: an already-expired grant answers 400, and
    refusing to disconnect over that would trap somebody in a connection that
    does not work.

    Cards imported from the calendar are kept. They may have been worked on,
    moved, commented on — deleting them because a connection was dropped would
    throw away work the calendar never owned.
    """
    account = _account_of(db, user)
    if account is None:
        return {"message": "Nothing was connected."}

    for encrypted in (account.refresh_token, account.access_token):
        token = decrypt(encrypted)
        if token:
            google.revoke(token)
            break

    _clear_links(db, user)
    db.delete(account)
    db.commit()
    return {"message": "Google Calendar disconnected."}


# --- Syncing -----------------------------------------------------------------

@router.post("/sync", response_model=schemas.SyncResult)
def run_sync(
    db: Session = Depends(get_db),
    user=Depends(require_permission("calendar.sync")),
):
    """Runs a sync now, against this account's own board.

    Synchronous, and answering with what it changed, because this endpoint is
    what a person pressing "Sync" is waiting on — a 202 and a promise would mean
    watching a board for cards that may or may not be coming. The board it syncs
    is always the personal one: a team board pushed into somebody's private
    Google calendar would publish colleagues' cards to an account they have no
    relationship with.
    """
    account = _require_account(db, user)
    board = personal_board(db, user)
    try:
        result = sync.sync_account(db, account, board)
    except (credentials.NotConnected, google.GoogleError) as error:
        raise _as_http(error) from error

    return schemas.SyncResult(
        imported=result.imported,
        updated_locally=result.updated_locally,
        removed_locally=result.removed_locally,
        exported=result.exported,
        updated_remotely=result.updated_remotely,
        removed_remotely=result.removed_remotely,
        errors=result.errors,
        last_sync_at=account.last_sync_at,
    )
