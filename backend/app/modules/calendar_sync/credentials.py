"""Getting a usable access token out of a stored connection.

One function matters here — `access_token_for` — and every caller in this module
goes through it rather than reading `account.access_token`. That is the point:
an access token lives an hour, so "the token in the row" and "a token that
works" are different things almost all of the time, and any code that reaches
for the column directly is a bug waiting for the hour to pass.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.tokenstore import decrypt, encrypt
from app.modules.calendar_sync import google, models
from app.modules.tasks.models import get_ist_now


class NotConnected(Exception):
    """This account has no usable grant, and reconnecting is the only fix.

    Distinct from `google.GoogleError` on purpose. A GoogleError says a request
    failed and may well work later; this says the stored credential is gone —
    revoked from Google's side, or unreadable after a key rotation — so the only
    honest thing the UI can do is offer the Connect button again.
    """


def _naive(at: datetime) -> datetime:
    return at.replace(tzinfo=None) if at.tzinfo else at


def store_tokens(
    account: models.GoogleAccount,
    response: dict,
    now: Optional[datetime] = None,
) -> None:
    """Writes a token response onto the row, encrypting on the way in.

    The refresh token is only overwritten when the response actually carries
    one. Google omits it from every refresh response and from some repeat
    authorisations, and a blind assignment would therefore blank the one
    credential that cannot be re-obtained without sending the owner back through
    consent.
    """
    at = _naive(now or get_ist_now())

    if response.get("access_token"):
        account.access_token = encrypt(response["access_token"])
    if response.get("refresh_token"):
        account.refresh_token = encrypt(response["refresh_token"])
    if response.get("scope"):
        account.scope = response["scope"]

    account.token_expires_at = google.expiry_from(response, at)


def access_token_for(db: Session, account: models.GoogleAccount) -> str:
    """A token that works right now, refreshing and persisting if it must.

    The refreshed token is committed rather than left in the session, because
    Google counts refresh requests and a sync that failed after refreshing would
    otherwise throw away a token it had already spent a round trip on.
    """
    now = _naive(get_ist_now())
    token = decrypt(account.access_token)

    if token and not google.is_expired(account.token_expires_at, now):
        return token

    refresh = decrypt(account.refresh_token)
    if not refresh:
        # Either Google never issued one, or JWT_SECRET_KEY has rotated and the
        # ciphertext no longer opens. Both mean the same thing to the caller.
        raise NotConnected(
            "Your Google connection needs to be set up again — reconnect from the "
            "calendar settings."
        )

    try:
        response = google.refresh_access_token(refresh)
    except google.GoogleError as error:
        # 400 and 401 from the token endpoint mean the grant is gone: revoked in
        # the Google account's own security settings, or the client secret
        # changed. Anything else — a timeout, a 503 — is Google being briefly
        # unavailable, and must not be reported as a broken connection.
        if error.status in (400, 401):
            raise NotConnected(
                "Google has revoked this connection. Reconnect to carry on syncing."
            ) from error
        raise

    store_tokens(account, response, now)
    db.commit()

    fresh = decrypt(account.access_token)
    if not fresh:
        raise NotConnected("Could not read the refreshed Google token.")
    return fresh
