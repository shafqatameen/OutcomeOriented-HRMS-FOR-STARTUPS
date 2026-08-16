"""Two-way sync between one person's board and one Google calendar.

The whole of the difficult thinking in this feature is in this file, and it comes
down to three decisions.

**A card and an event are the same object seen twice.** The link is
`cards.google_event_id`, which is unique, so one event can never fan out across
two cards no matter how many times a sync is retried. An imported event becomes
an ordinary card — draggable, editable, completable — and not a read-only
overlay, because a plan you cannot move is not a plan. That is also why the
Planner needs no special case for them: they are cards with a due date, and the
day grid already draws those.

**Every card with a time on it belongs on the calendar, wherever it sits.** Push
does not read only the Calendar list. A card parked in Next Actions with a due
date at 3pm is exactly as scheduled as one filed under Calendar — the same
argument the Planner's own endpoint makes — and a calendar that showed one and
not the other would be worse than no calendar, because it would be trusted.

**Conflicts resolve last-write-wins, and the loser is announced.** Both sides are
editable, so the same card can change in both places between two syncs. Google
stamps every event with `updated`; we stamp every card with `updated_at`; the
newer stamp wins. This is not perfect and cannot be — the two timestamps come
from two clocks, so a change made within seconds of another on a server whose
clock has drifted can lose to it. It is chosen anyway over the alternatives:
refusing to sync until a human resolves the conflict turns a background
convenience into a chore, and merging field-by-field silently invents a third
version that neither side ever wrote. Where it matters, the sync result reports
what it changed, so a surprising overwrite is at least visible.

A note on what this is *not*: there is no worker process in this app, so nothing
here runs on a timer. A sync happens when somebody asks for one — opening the
board, pressing Sync. That is a real limitation and it is deliberate rather than
unfinished: a push subscription would need a public HTTPS callback Google can
reach, which a self-hosted install behind aaPanel may not have.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.boards import models as board_models
from app.modules.calendar_sync import credentials, google, models
from app.modules.tasks.models import get_ist_now

#: What a card with a due time but no start time occupies on the calendar.
#: Matches the Planner's own assumption (components/board/PlannerPane.tsx), so a
#: block is the same size in both places.
DEFAULT_DURATION_MINUTES = 30

#: A title for an event that has none. Google allows it; a blank card is a card
#: nobody can find again.
UNTITLED = "(no title)"

#: How many per-item failures to keep. A sync against a calendar that is
#: refusing every write should report the problem once, not five hundred times.
MAX_REPORTED_ERRORS = 5


@dataclass
class SyncResult:
    """What one sync did, in the terms the person who pressed the button cares about."""
    imported: int = 0
    updated_locally: int = 0
    removed_locally: int = 0
    exported: int = 0
    updated_remotely: int = 0
    removed_remotely: int = 0
    errors: List[str] = field(default_factory=list)

    @property
    def changed(self) -> int:
        return (
            self.imported
            + self.updated_locally
            + self.removed_locally
            + self.exported
            + self.updated_remotely
            + self.removed_remotely
        )

    def note(self, message: str) -> None:
        if len(self.errors) < MAX_REPORTED_ERRORS and message not in self.errors:
            self.errors.append(message)


def _naive(at: Optional[datetime]) -> Optional[datetime]:
    if at is None:
        return None
    return at.replace(tzinfo=None) if at.tzinfo else at


# --- Board geography ---------------------------------------------------------

def _live_lists(board: board_models.Board) -> List[board_models.BoardList]:
    return [lst for lst in board.lists if lst.archived_at is None]


def _landing_list(board: board_models.Board) -> Optional[board_models.BoardList]:
    """Where an imported event becomes a card.

    The Calendar list when there is one, because that is what it is for. Falling
    back to the first list rather than refusing, since the owner is free to have
    deleted or renamed every system list and an import that gave up on them
    would be punishing them for using the board as told.
    """
    live = _live_lists(board)
    return next((lst for lst in live if lst.role == "calendar"), None) or (live[0] if live else None)


def _trash_list(board: board_models.Board) -> Optional[board_models.BoardList]:
    return next((lst for lst in _live_lists(board) if lst.role == "trash"), None)


def _next_position(db: Session, list_id: int) -> int:
    highest = (
        db.query(func.max(board_models.Card.position))
        .filter(board_models.Card.list_id == list_id)
        .scalar()
    )
    return (highest or 0) + board_models.POSITION_STEP


# --- Card ↔ event ------------------------------------------------------------

def _card_span(card: board_models.Card) -> tuple:
    """The block this card occupies, as `(start, end)`.

    A card carries a deadline, not a duration, so a card with only a due date is
    given the same half hour the Planner draws for it. Guarding against
    start-after-due matters because nothing stops somebody typing one: Google
    rejects an event that ends before it begins, and one bad card must not fail
    the whole sync.
    """
    due = _naive(card.due_at)
    start = _naive(card.start_at)
    if start is None or start >= due:
        start = due - timedelta(minutes=DEFAULT_DURATION_MINUTES)
    return start, due


def _apply_event(card: board_models.Card, event: dict, times: tuple) -> bool:
    """Copies an event onto a card. True if anything actually differed.

    The comparison is what stops a sync loop. Writing the fields unconditionally
    would bump `updated_at` on every card on every sync, which would then make
    the next push believe every card had been edited and send the lot back to
    Google — a stable pair of documents rewriting each other forever.
    """
    start, end, _all_day = times
    title = (event.get("summary") or UNTITLED).strip() or UNTITLED
    description = event.get("description") or None

    changed = False
    if card.title != title:
        card.title = title
        changed = True
    if card.description != description:
        card.description = description
        changed = True
    if _naive(card.start_at) != start:
        card.start_at = start
        changed = True
    if _naive(card.due_at) != end:
        card.due_at = end
        changed = True
    return changed


# --- Pull --------------------------------------------------------------------

def _pull(
    db: Session,
    account: models.GoogleAccount,
    board: board_models.Board,
    token: str,
    window: tuple,
    result: SyncResult,
) -> Set[int]:
    """Google's events into cards. Returns the card ids it touched.

    Those ids are handed to the push pass and skipped there. Without that, every
    card this pass just wrote would look freshly edited on the way back out and
    be pushed straight to Google again — a change echoing between the two
    systems for no reason.
    """
    touched: Set[int] = set()
    events = google.list_events(token, account.calendar_id, window[0], window[1])

    list_ids = [lst.id for lst in _live_lists(board)]
    linked: Dict[str, board_models.Card] = {
        card.google_event_id: card
        for card in db.query(board_models.Card)
        .filter(
            board_models.Card.list_id.in_(list_ids),
            board_models.Card.google_event_id.isnot(None),
        )
        .all()
    }

    landing = _landing_list(board)
    trash = _trash_list(board)

    for event in events:
        event_id = event.get("id")
        if not event_id:
            continue
        card = linked.get(event_id)

        if event.get("status") == "cancelled":
            # The event is gone from Google. Trash the card rather than deleting
            # it: an event cancelled by somebody else on a shared meeting should
            # not silently take away notes its owner wrote on the card. The link
            # is cleared so a later re-import cannot collide on the unique index.
            if card is not None:
                if trash is not None and card.list_id != trash.id:
                    card.list_id = trash.id
                    card.position = _next_position(db, trash.id)
                card.google_event_id = None
                touched.add(card.id)
                result.removed_locally += 1
            continue

        times = google.event_times(event)
        if times is None:
            continue

        if card is None:
            if landing is None:
                result.note("This board has no list to import events into.")
                break
            card = board_models.Card(
                list_id=landing.id,
                title=(event.get("summary") or UNTITLED).strip() or UNTITLED,
                description=event.get("description") or None,
                start_at=times[0],
                due_at=times[1],
                google_event_id=event_id,
                source="calendar_sync",
                position=_next_position(db, landing.id),
                created_by_user_id=account.user_id,
            )
            db.add(card)
            db.flush()
            linked[event_id] = card
            touched.add(card.id)
            result.imported += 1
            continue

        # Last write wins. `updated` is Google's own stamp on the event, in UTC;
        # `updated_at` is ours, in IST. from_rfc3339 puts both on one clock face.
        remote_updated = _naive(google.from_rfc3339(event["updated"])) if event.get("updated") else None
        local_updated = _naive(card.updated_at)
        if remote_updated and local_updated and remote_updated <= local_updated:
            continue

        if _apply_event(card, event, times):
            touched.add(card.id)
            result.updated_locally += 1

    db.commit()
    return touched


# --- Push --------------------------------------------------------------------

def _push(
    db: Session,
    account: models.GoogleAccount,
    board: board_models.Board,
    token: str,
    window: tuple,
    skip: Set[int],
    result: SyncResult,
) -> None:
    """Cards onto Google.

    Three cases, and the two destructive ones are worth naming because they are
    how a card leaves the calendar at all. A card whose due date was cleared is
    no longer scheduled, and a card moved to Trash is on its way out — in both
    cases the event is deleted and the link cleared, so the calendar stops
    showing an appointment its owner has already cancelled on the board.
    """
    trash = _trash_list(board)
    trash_id = trash.id if trash else None
    list_ids = [lst.id for lst in _live_lists(board)]
    since = _naive(account.last_sync_at)

    candidates = (
        db.query(board_models.Card)
        .filter(board_models.Card.list_id.in_(list_ids))
        .filter(
            # Everything schedulable in the window, plus every card still
            # holding a link — the second half is what lets an event be deleted
            # after its card was trashed or its date removed.
            board_models.Card.google_event_id.isnot(None)
            | (
                board_models.Card.due_at.isnot(None)
                & (board_models.Card.due_at >= window[0])
                & (board_models.Card.due_at < window[1])
            )
        )
        .all()
    )

    for card in candidates:
        if card.id in skip:
            continue

        retired = card.due_at is None or (trash_id is not None and card.list_id == trash_id)

        if retired:
            if card.google_event_id:
                try:
                    google.delete_event(token, account.calendar_id, card.google_event_id)
                except google.GoogleError as error:
                    result.note(str(error))
                    continue
                card.google_event_id = None
                result.removed_remotely += 1
            continue

        start, end = _card_span(card)
        body = google.event_body(card.title, card.description, start, end)

        if card.google_event_id:
            # Unchanged since the last sync finished, so Google already has this
            # exact content and a PATCH would be a round trip to write it again.
            edited_at = _naive(card.updated_at)
            if since is not None and edited_at is not None and edited_at <= since:
                continue
            try:
                google.patch_event(token, account.calendar_id, card.google_event_id, body)
            except google.GoogleError as error:
                if error.status in (404, 410):
                    # Deleted on Google's side outside a window we ever read.
                    # Drop the link so the next sync re-creates the event rather
                    # than patching a ghost forever.
                    card.google_event_id = None
                    continue
                result.note(str(error))
                continue
            result.updated_remotely += 1
            continue

        try:
            created = google.insert_event(token, account.calendar_id, body)
        except google.GoogleError as error:
            result.note(str(error))
            continue
        if created.get("id"):
            card.google_event_id = created["id"]
            result.exported += 1

    db.commit()


# --- Local deletes -----------------------------------------------------------

def forget_card(db: Session, board: board_models.Board, card: board_models.Card) -> None:
    """Deletes the Google event behind a card that is about to be destroyed.

    Called from the board router's hard delete, and it exists because that is
    the one card ending the sync can never learn about on its own. Every other
    disappearance leaves something to read — a trashed card is still a row, a
    cancelled event still arrives with `status: cancelled` — but a deleted row
    takes its `google_event_id` with it, and the next pull would then see an
    event it has no card for and dutifully import it again. The card would come
    back from the dead, which is the worst failure this feature could have.

    Entirely best effort. A person deleting a card is not waiting on Google, and
    a network blip must not turn a local delete into an error dialog; the cost
    of failing here is one orphaned event, which is visible and fixable, against
    a delete that appeared not to work, which is neither.
    """
    if not card.google_event_id or board.owner_user_id is None:
        return

    account = (
        db.query(models.GoogleAccount)
        .filter(models.GoogleAccount.user_id == board.owner_user_id)
        .first()
    )
    if account is None or not account.push_enabled:
        return

    try:
        token = credentials.access_token_for(db, account)
        google.delete_event(token, account.calendar_id, card.google_event_id)
    except Exception:  # noqa: BLE001 - see the docstring: the delete must win.
        return


# --- Entry point -------------------------------------------------------------

def sync_account(
    db: Session,
    account: models.GoogleAccount,
    board: board_models.Board,
) -> SyncResult:
    """Runs one full sync for one account. Pull first, then push.

    Pull leads because it is the pass that learns things: an event created in
    Google since the last run has to become a card before push can decide it is
    already represented. Reversing them would export a card for an event that
    already exists and leave the calendar showing it twice.
    """
    result = SyncResult()
    now = _naive(get_ist_now())
    window = (
        now - timedelta(days=account.past_days),
        now + timedelta(days=account.future_days),
    )

    token = credentials.access_token_for(db, account)

    touched: Set[int] = set()
    try:
        if account.pull_enabled:
            touched = _pull(db, account, board, token, window, result)
        if account.push_enabled:
            _push(db, account, board, token, window, touched, result)
    except google.GoogleError as error:
        db.rollback()
        account.last_sync_error = str(error)
        db.commit()
        raise

    # Stamped at the end rather than the start, so the cards this run wrote to —
    # whose `updated_at` was bumped moments ago — are not seen as edited by the
    # next push. The trade is a change made *during* a sync waiting for the run
    # after next, which is seconds of exposure against a permanent re-push loop.
    account.last_sync_at = _naive(get_ist_now())
    account.last_sync_error = "; ".join(result.errors) if result.errors else None
    db.commit()
    return result
