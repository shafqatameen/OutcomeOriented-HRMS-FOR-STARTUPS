"""One person's link to one Google Calendar.

The whole design of this table is in its unique constraint: `user_id` is unique,
so a Google account is attached to an *account*, never to a board and never to
the installation. That is not an implementation detail, it is the privacy model.
Alice authorises Google once, from her own session; the tokens that come back
are hers; every read and write this module makes on Google runs under the tokens
belonging to the account that asked. There is no path by which Bob's session
reaches Alice's calendar, because there is no lookup here that takes anything
other than the caller's own user id — see router.py, where no endpoint accepts
one.

That is also why this is a table rather than a handful of settings on `users`.
A calendar link has a lifecycle of its own — granted, refreshed, erroring,
revoked — and deleting the row is what disconnecting *means*. Columns on `users`
would leave "connected" as a scatter of nullable fields with no single answer,
and revocation as a multi-column blanking that could half-fail.

The tokens themselves are ciphertext, for the reason app/core/tokenstore.py sets
out at length: a refresh token is a live, long-lived grant on somebody's
calendar rather than a proof of anything, so the only defence against a stolen
copy of the database file is that the copy cannot be read.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.base import Base
from app.modules.tasks.models import get_ist_now

#: What Google calls the calendar you get by default. Stored explicitly rather
#: than left null, so "which calendar is this writing to?" always has an answer.
PRIMARY_CALENDAR_ID = "primary"

#: Default sync window, in days either side of now.
#:
#: Bounded rather than "everything" because a calendar is unbounded in both
#: directions — a weekly recurrence expands to hundreds of events a year, and a
#: full pull would fill the board with meetings from 2019. Backwards is short
#: because the past is read, not worked on; forwards is a quarter, which is the
#: horizon a plan is actually made over.
DEFAULT_PAST_DAYS = 7
DEFAULT_FUTURE_DAYS = 90

#: Ceilings on what the owner may widen the window to, so one sync cannot try to
#: page through a decade of recurrences.
MAX_PAST_DAYS = 365
MAX_FUTURE_DAYS = 365


class GoogleAccount(Base):
    """The Google Calendar connection belonging to exactly one account."""
    __tablename__ = "google_accounts"

    id = Column(Integer, primary_key=True, index=True)
    #: Unique: one Google connection per account. A second authorisation
    #: replaces the first rather than accumulating, because two live grants for
    #: one person is a state with no sensible answer to "which calendar is
    #: yours?".
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    #: Which Google account this is, read from the id_token at authorisation.
    #: Shown in the UI and stored for no other purpose: connecting the wrong
    #: Google account is the mistake people actually make, and it is invisible
    #: unless the address is on screen.
    google_email = Column(String, nullable=True)

    #: Fernet ciphertext. Never read directly — see `credentials.py`.
    access_token = Column(Text, nullable=True)
    #: Also ciphertext. Null when Google declined to issue one, which happens on
    #: a re-authorisation it considers redundant; the router forces `prompt=
    #: consent` precisely so this stays populated, since without it the link
    #: dies silently an hour later.
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    #: The scopes actually granted, which are not always the scopes asked for —
    #: Google's consent screen lets a person tick a subset.
    scope = Column(Text, nullable=True)

    #: Which of that account's calendars to read and write. "primary" unless the
    #: owner picked another from the settings dialog.
    calendar_id = Column(String, nullable=False, server_default=PRIMARY_CALENDAR_ID,
                         default=PRIMARY_CALENDAR_ID)
    calendar_name = Column(String, nullable=True)

    #: The two directions, separately switchable, because they are separately
    #: wanted. "Show me my meetings so I can plan around them" is a common thing
    #: to want without also publishing every card to a calendar colleagues can
    #: see, and the reverse is just as reasonable.
    pull_enabled = Column(Boolean, nullable=False, server_default="1", default=True)
    push_enabled = Column(Boolean, nullable=False, server_default="1", default=True)

    past_days = Column(Integer, nullable=False, server_default=str(DEFAULT_PAST_DAYS),
                       default=DEFAULT_PAST_DAYS)
    future_days = Column(Integer, nullable=False, server_default=str(DEFAULT_FUTURE_DAYS),
                         default=DEFAULT_FUTURE_DAYS)

    #: When the last sync finished. Doubles as the "changed since" mark the push
    #: pass uses to decide which cards need sending — see sync.py.
    last_sync_at = Column(DateTime, nullable=True)
    #: The last failure, kept so the UI can say what went wrong rather than
    #: "sync failed". Cleared by the next success.
    last_sync_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=get_ist_now, nullable=False)
    updated_at = Column(DateTime, default=get_ist_now, onupdate=get_ist_now, nullable=False)

    user = relationship("app.modules.users.models.User")
