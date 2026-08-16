"""The board API.

Two rules run through every endpoint here, and they are worth stating once
rather than repeating in each docstring.

**Access is resolved from the board, never from the id you were given.** No route
takes a user id, and no route trusts a list or card id on its own: a list is
looked up, its board is resolved, and that board is checked against the caller
before anything is read or written. A row belonging to someone else answers 404
rather than 403, for the reason inbox/router.py gives — a 403 confirms the row
exists, and who keeps what on their private board is not something this API
should be willing to confirm.

**Order is an integer column the server owns.** Clients send a destination index
("dropped third"), not a position value, so two people dragging at once cannot
invent conflicting sort keys. See `_reindex`.
"""
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.modules.auth.dependencies import require_permission
from app.modules.boards import models, schemas
from app.modules.tasks.models import get_ist_now
from app.modules.users import models as user_models

router = APIRouter(prefix="/boards", tags=["Boards"])

#: Lists, cards and their parts, addressed by their own id at the root.
#:
#: A second router rather than more paths under /boards, because `/boards/cards/5`
#: and `/boards/{board_id}` are the same shape to a router: whichever is declared
#: first wins, and "cards" then arrives where an integer id was expected. Keeping
#: them apart makes the collision impossible instead of order-dependent. A card
#: knows its list and a list knows its board, so none of these needs a board id
#: in the path to resolve access — see `_card_for`.
elements_router = APIRouter(tags=["Boards"])

MAX_TITLE_LENGTH = 500
MAX_TEXT_LENGTH = 20_000

#: Roles that may write. "viewer" is read-only, and that is the whole point of it.
WRITE_ROLES = {"owner", "admin", "member"}
#: Roles that may reshape the board itself — its lists, labels and membership.
ADMIN_ROLES = {"owner", "admin"}


# --- Validation --------------------------------------------------------------

def _clean(value: str, field: str, limit: int = MAX_TITLE_LENGTH) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{field} cannot be empty")
    if len(cleaned) > limit:
        raise HTTPException(status_code=400, detail=f"{field} is longer than {limit} characters")
    return cleaned


def _clean_optional(value: Optional[str], limit: int = MAX_TEXT_LENGTH) -> Optional[str]:
    """Blank collapses to null, so "cleared the description" is one state."""
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) > limit:
        raise HTTPException(status_code=400, detail=f"That is longer than {limit} characters")
    return cleaned or None


# --- Access ------------------------------------------------------------------

def _role_on(board: models.Board, user) -> Optional[str]:
    """This account's authority on this board, or None if it cannot see it."""
    if board.board_type == "personal":
        return "owner" if board.owner_user_id == user.id else None
    if board.owner_user_id == user.id:
        return "owner"
    for member in board.members:
        if member.user_id == user.id:
            return member.role
    # An Admin can administer any team board, the same superuser bypass
    # require_permission already grants everywhere else. Deliberately *not*
    # extended to personal boards above: role is about running the company, and
    # somebody's private someday list is not company business.
    return "admin" if user.role == "Admin" else None


def _load_board(db: Session, board_id: int) -> Optional[models.Board]:
    return (
        db.query(models.Board)
        .options(
            selectinload(models.Board.lists).selectinload(models.BoardList.cards),
            selectinload(models.Board.labels),
            selectinload(models.Board.members).selectinload(models.BoardMember.user),
        )
        .filter(models.Board.id == board_id)
        .first()
    )


def _board_for(db: Session, user, board_id: int, need: Iterable[str] = ()) -> tuple:
    """A board this account may reach, with its role. 404 when it may not.

    `need` names the roles the action requires. Failing that check is a real 403:
    once you can see a board, being told you may only read it is useful rather
    than leaky.
    """
    board = _load_board(db, board_id)
    role = _role_on(board, user) if board else None
    if not board or role is None:
        raise HTTPException(status_code=404, detail="Board not found")
    if need and role not in set(need):
        raise HTTPException(status_code=403, detail="You have read-only access to this board")
    return board, role


def _list_for(db: Session, user, list_id: int, need: Iterable[str] = ()) -> tuple:
    board_list = db.query(models.BoardList).filter(models.BoardList.id == list_id).first()
    if not board_list:
        raise HTTPException(status_code=404, detail="List not found")
    board, role = _board_for(db, user, board_list.board_id, need)
    return board_list, board, role


def _card_for(db: Session, user, card_id: int, need: Iterable[str] = ()) -> tuple:
    card = (
        db.query(models.Card)
        .options(
            selectinload(models.Card.checklist),
            selectinload(models.Card.comments).selectinload(models.Comment.user),
            selectinload(models.Card.card_labels).selectinload(models.CardLabel.label),
            selectinload(models.Card.assignees).selectinload(models.CardAssignee.user),
        )
        .filter(models.Card.id == card_id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    board_list, board, role = _list_for(db, user, card.list_id, need)
    return card, board_list, board, role


# --- Provisioning ------------------------------------------------------------

def personal_board(db: Session, user) -> models.Board:
    """This account's own board, created with the GTD template on first ask.

    Provisioned lazily rather than by migration or at signup, because a board
    seeded for an account that never opens the page is twelve rows of clutter,
    and because lazily means existing accounts get theirs without a backfill.
    """
    board = (
        db.query(models.Board)
        .filter(
            models.Board.owner_user_id == user.id,
            models.Board.board_type == "personal",
        )
        .first()
    )
    if board:
        return board

    board = models.Board(
        owner_user_id=user.id,
        name=models.PERSONAL_BOARD_NAME,
        board_type="personal",
    )
    db.add(board)
    db.flush()
    _seed_template(db, board)
    db.commit()
    db.refresh(board)
    return board


def _seed_template(db: Session, board: models.Board) -> None:
    for index, (name, role) in enumerate(models.DEFAULT_LISTS):
        db.add(
            models.BoardList(
                board_id=board.id,
                name=name,
                role=role,
                position=index * models.POSITION_STEP,
                is_system_default=True,
            )
        )


def _purge_trash(db: Session, board: models.Board) -> None:
    """Deletes cards that have sat in a Trash list past the board's window.

    Run on board read rather than on a schedule: this app has no worker process,
    and a purge that only happens when somebody looks is still a purge. Nothing
    downstream references a card, so this is a hard delete — see the same
    argument in inbox/router.py's discard.
    """
    if not board.trash_purge_days:
        return
    trash_ids = [lst.id for lst in board.lists if lst.role == "trash"]
    if not trash_ids:
        return

    cutoff = get_ist_now() - timedelta(days=board.trash_purge_days)
    stale = (
        db.query(models.Card)
        .filter(models.Card.list_id.in_(trash_ids), models.Card.updated_at < cutoff)
        .all()
    )
    if not stale:
        return
    for card in stale:
        db.delete(card)
    db.commit()


# --- Ordering ----------------------------------------------------------------

def _next_position(db: Session, list_id: int) -> int:
    highest = (
        db.query(func.max(models.Card.position))
        .filter(models.Card.list_id == list_id)
        .scalar()
    )
    return (highest or 0) + models.POSITION_STEP


def _reindex(db: Session, list_id: int, ordered_ids: List[int]) -> None:
    """Rewrites one list's positions from an explicit order, gapped.

    The whole column for that list, not a single row: fractional or gap-seeking
    inserts drift, and one list is small enough that restating it is cheaper than
    a scheme that eventually needs compacting anyway.
    """
    for index, card_id in enumerate(ordered_ids):
        db.query(models.Card).filter(
            models.Card.id == card_id, models.Card.list_id == list_id
        ).update({"position": (index + 1) * models.POSITION_STEP})


# --- Serialisation -----------------------------------------------------------

def _labels_of(card: models.Card) -> List[dict]:
    return [
        {"id": link.label.id, "name": link.label.name, "color": link.label.color}
        for link in card.card_labels
        if link.label is not None
    ]


def _assignees_of(card: models.Card) -> List[dict]:
    return [
        {
            "user_id": link.user_id,
            "user_name": link.user.name if link.user else None,
        }
        for link in card.assignees
    ]


def _card_payload(card: models.Card, comment_count: Optional[int] = None) -> dict:
    return {
        "id": card.id,
        "list_id": card.list_id,
        "title": card.title,
        "description": card.description,
        "due_at": card.due_at,
        "start_at": card.start_at,
        "completed_at": card.completed_at,
        "google_event_id": card.google_event_id,
        "source": card.source,
        "position": card.position,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "checklist": card.checklist,
        "labels": _labels_of(card),
        "assignees": _assignees_of(card),
        "comment_count": len(card.comments) if comment_count is None else comment_count,
    }


def _card_detail_payload(card: models.Card) -> dict:
    payload = _card_payload(card)
    payload["comments"] = [
        {
            "id": comment.id,
            "text": comment.text,
            "user_id": comment.user_id,
            "user_name": comment.user.name if comment.user else None,
            "created_at": comment.created_at,
        }
        for comment in card.comments
    ]
    return payload


def _comment_counts(db: Session, card_ids: List[int]) -> Dict[int, int]:
    """One grouped count for the whole board, rather than per card.

    The board view shows a comment badge on every card face; loading each card's
    comments to length them would be a query per card on a board that can hold
    hundreds.
    """
    if not card_ids:
        return {}
    rows = (
        db.query(models.Comment.card_id, func.count(models.Comment.id))
        .filter(models.Comment.card_id.in_(card_ids))
        .group_by(models.Comment.card_id)
        .all()
    )
    return {card_id: count for card_id, count in rows}


def _board_payload(db: Session, board: models.Board, role: str) -> dict:
    visible = [lst for lst in board.lists if lst.archived_at is None]
    card_ids = [card.id for lst in visible for card in lst.cards]
    counts = _comment_counts(db, card_ids)
    return {
        "id": board.id,
        "name": board.name,
        "board_type": board.board_type,
        "owner_user_id": board.owner_user_id,
        "trash_purge_days": board.trash_purge_days,
        "my_role": role,
        "lists": [
            {
                "id": lst.id,
                "name": lst.name,
                "position": lst.position,
                "role": lst.role,
                "is_system_default": lst.is_system_default,
                "cards": [
                    _card_payload(card, counts.get(card.id, 0))
                    for card in sorted(lst.cards, key=lambda c: (c.position, c.id))
                ],
            }
            for lst in sorted(visible, key=lambda l: (l.position, l.id))
        ],
        "labels": board.labels,
        "members": [
            {
                "user_id": member.user_id,
                "user_name": member.user.name if member.user else None,
                "role": member.role,
            }
            for member in board.members
        ],
    }


# --- Boards ------------------------------------------------------------------

@router.get("", response_model=List[schemas.BoardSummary])
def read_boards(
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Every board this account can open, personal first — the switcher's data.

    Reading the list is what provisions the personal board, so the first visit
    to MyUniverse already has somewhere to put things.
    """
    own = personal_board(db, user)

    team_query = db.query(models.Board).filter(models.Board.board_type == "team")
    if user.role != "Admin":
        team_query = team_query.join(
            models.BoardMember, models.BoardMember.board_id == models.Board.id
        ).filter(models.BoardMember.user_id == user.id)
    teams = team_query.order_by(models.Board.name).all()

    boards = [own, *teams]
    counts = dict(
        db.query(models.BoardList.board_id, func.count(models.Card.id))
        .outerjoin(models.Card, models.Card.list_id == models.BoardList.id)
        .filter(models.BoardList.board_id.in_([b.id for b in boards]))
        .group_by(models.BoardList.board_id)
        .all()
    )
    return [
        {
            "id": board.id,
            "name": board.name,
            "board_type": board.board_type,
            "owner_user_id": board.owner_user_id,
            "my_role": _role_on(board, user) or "viewer",
            "card_count": counts.get(board.id, 0),
        }
        for board in boards
    ]


@router.get("/mine", response_model=schemas.Board)
def read_my_board(
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """The personal board in full. The entry point MyUniverse loads on first paint."""
    board = personal_board(db, user)
    return read_board(board.id, db, user)


@router.post("", response_model=schemas.BoardSummary, status_code=201)
def create_board(
    payload: schemas.BoardCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.team")),
):
    """Creates a shared board. Blank unless the GTD template is asked for.

    The creator is its owner and does not need a membership row; everyone named
    in `member_ids` gets one as a plain member, editable afterwards.
    """
    board = models.Board(
        owner_user_id=user.id,
        name=_clean(payload.name, "Board name"),
        board_type="team",
    )
    db.add(board)
    db.flush()

    if payload.use_gtd_template:
        _seed_template(db, board)
    else:
        for index, name in enumerate(("To Do", "Doing", "Done")):
            db.add(
                models.BoardList(
                    board_id=board.id,
                    name=name,
                    position=index * models.POSITION_STEP,
                )
            )

    for user_id in dict.fromkeys(payload.member_ids):
        if user_id == user.id:
            continue
        db.add(models.BoardMember(board_id=board.id, user_id=user_id, role="member"))

    db.commit()
    db.refresh(board)
    return {
        "id": board.id,
        "name": board.name,
        "board_type": board.board_type,
        "owner_user_id": board.owner_user_id,
        "my_role": "owner",
        "card_count": 0,
    }


@router.get("/{board_id}", response_model=schemas.Board)
def read_board(
    board_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """One board, with every visible list and card. The board view's single read.

    Nested rather than a call per list because the board is drawn all at once —
    a partially-loaded Kanban is worse than a slower one.
    """
    board, role = _board_for(db, user, board_id)
    _purge_trash(db, board)
    db.refresh(board)
    return _board_payload(db, board, role)


@router.patch("/{board_id}", response_model=schemas.BoardSummary)
def update_board(
    board_id: int,
    payload: schemas.BoardUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    board, role = _board_for(db, user, board_id, need=ADMIN_ROLES)
    if payload.name is not None:
        board.name = _clean(payload.name, "Board name")
    if "trash_purge_days" in payload.model_fields_set:
        days = payload.trash_purge_days
        if days is not None and days < 1:
            raise HTTPException(status_code=400, detail="Purge after at least one day, or never")
        board.trash_purge_days = days
    db.commit()
    db.refresh(board)
    return {
        "id": board.id,
        "name": board.name,
        "board_type": board.board_type,
        "owner_user_id": board.owner_user_id,
        "my_role": role,
        "card_count": 0,
    }


@router.delete("/{board_id}")
def delete_board(
    board_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Deletes a team board and everything on it. A personal board is refused.

    Not out of caution about the cards — Trash already handles those — but
    because the personal board is where the account *lives*. Deleting it would
    only cause the next read to seed an empty one, so the honest answer is no.
    """
    board, _ = _board_for(db, user, board_id, need=ADMIN_ROLES)
    if board.board_type == "personal":
        raise HTTPException(
            status_code=400,
            detail="Your own board cannot be deleted. Delete its lists instead.",
        )
    db.delete(board)
    db.commit()
    return {"message": "Board deleted", "board_id": board_id}


@router.put("/{board_id}/members", response_model=List[schemas.BoardMember])
def set_member(
    board_id: int,
    payload: schemas.BoardMemberUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Adds a member or changes their role. Team boards only."""
    board, _ = _board_for(db, user, board_id, need=ADMIN_ROLES)
    if board.board_type == "personal":
        raise HTTPException(
            status_code=400,
            detail="A personal board has no members. Create a team board to share work.",
        )
    if not db.query(user_models.User).filter(user_models.User.id == payload.user_id).first():
        raise HTTPException(status_code=404, detail="Account not found")

    existing = next((m for m in board.members if m.user_id == payload.user_id), None)
    if existing:
        existing.role = payload.role
    else:
        db.add(models.BoardMember(board_id=board.id, user_id=payload.user_id, role=payload.role))
    db.commit()
    db.refresh(board)
    return [
        {
            "user_id": member.user_id,
            "user_name": member.user.name if member.user else None,
            "role": member.role,
        }
        for member in board.members
    ]


@router.delete("/{board_id}/members/{user_id}")
def remove_member(
    board_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    board, _ = _board_for(db, user, board_id, need=ADMIN_ROLES)
    member = next((m for m in board.members if m.user_id == user_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Not a member of this board")
    db.delete(member)
    db.commit()
    return {"message": "Member removed", "user_id": user_id}


# --- Lists -------------------------------------------------------------------

@router.post("/{board_id}/lists", response_model=schemas.BoardList, status_code=201)
def create_list(
    board_id: int,
    payload: schemas.BoardListCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    board, _ = _board_for(db, user, board_id, need=ADMIN_ROLES)
    highest = (
        db.query(func.max(models.BoardList.position))
        .filter(models.BoardList.board_id == board.id)
        .scalar()
    )
    board_list = models.BoardList(
        board_id=board.id,
        name=_clean(payload.name, "List name"),
        position=(highest or 0) + models.POSITION_STEP,
    )
    db.add(board_list)
    db.commit()
    db.refresh(board_list)
    return {
        "id": board_list.id,
        "name": board_list.name,
        "position": board_list.position,
        "role": board_list.role,
        "is_system_default": board_list.is_system_default,
        "cards": [],
    }


@elements_router.patch("/lists/{list_id}", response_model=schemas.BoardList)
def update_list(
    list_id: int,
    payload: schemas.BoardListUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Renames or archives a list. A seeded list renames like any other.

    Its `role` survives the rename, so calling Calendar "Diary" keeps the Planner
    pointed at the right column — the reason role exists at all.
    """
    board_list, _board, _role = _list_for(db, user, list_id, need=ADMIN_ROLES)
    if payload.name is not None:
        board_list.name = _clean(payload.name, "List name")
    if payload.is_archived is not None:
        board_list.archived_at = get_ist_now() if payload.is_archived else None
    db.commit()
    db.refresh(board_list)
    return {
        "id": board_list.id,
        "name": board_list.name,
        "position": board_list.position,
        "role": board_list.role,
        "is_system_default": board_list.is_system_default,
        "cards": [],
    }


@elements_router.delete("/lists/{list_id}")
def delete_list(
    list_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Deletes a list and its cards. Archive instead to keep them."""
    board_list, _board, _role = _list_for(db, user, list_id, need=ADMIN_ROLES)
    db.delete(board_list)
    db.commit()
    return {"message": "List deleted", "list_id": list_id}


@router.patch("/{board_id}/lists/reorder")
def reorder_lists(
    board_id: int,
    payload: schemas.ListReorder,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Left-to-right order for the whole board. Ids not on the board are ignored.

    A partial order is accepted and completed rather than refused: the ids given
    go first, and any list left out keeps its relative place behind them. Only
    renumbering the named ones would leave them tied with the lists that kept
    their old positions, and a tie is decided by row id — so a drag would land
    somewhere nobody chose.
    """
    board, _ = _board_for(db, user, board_id, need=ADMIN_ROLES)
    known = {lst.id for lst in board.lists}
    named = [list_id for list_id in dict.fromkeys(payload.list_ids) if list_id in known]
    rest = [
        lst.id
        for lst in sorted(board.lists, key=lambda l: (l.position, l.id))
        if lst.id not in set(named)
    ]
    for index, list_id in enumerate(named + rest):
        db.query(models.BoardList).filter(models.BoardList.id == list_id).update(
            {"position": (index + 1) * models.POSITION_STEP}
        )
    db.commit()
    return {"message": "Lists reordered"}


# --- Cards -------------------------------------------------------------------

def _apply_labels(db: Session, board: models.Board, card: models.Card, label_ids: List[int]) -> None:
    """Replaces the card's labels. Ids from another board are refused, not dropped."""
    wanted = dict.fromkeys(label_ids)
    owned = {label.id for label in board.labels}
    unknown = [label_id for label_id in wanted if label_id not in owned]
    if unknown:
        raise HTTPException(status_code=400, detail="That label is not on this board")

    for link in list(card.card_labels):
        if link.label_id not in wanted:
            db.delete(link)
    existing = {link.label_id for link in card.card_labels}
    for label_id in wanted:
        if label_id not in existing:
            db.add(models.CardLabel(card_id=card.id, label_id=label_id))


def _apply_assignees(
    db: Session, board: models.Board, card: models.Card, user_ids: List[int]
) -> None:
    """Replaces the card's assignees. Personal boards have nobody to assign to."""
    wanted = dict.fromkeys(user_ids)
    if wanted and board.board_type == "personal":
        raise HTTPException(
            status_code=400,
            detail="Cards on your own board cannot be assigned. Use a team board to share work.",
        )
    if wanted:
        allowed = {member.user_id for member in board.members} | {board.owner_user_id}
        if not set(wanted) <= allowed:
            raise HTTPException(status_code=400, detail="That account is not on this board")

    for link in list(card.assignees):
        if link.user_id not in wanted:
            db.delete(link)
    existing = {link.user_id for link in card.assignees}
    for user_id in wanted:
        if user_id not in existing:
            db.add(models.CardAssignee(card_id=card.id, user_id=user_id))


@elements_router.post("/lists/{list_id}/cards", response_model=schemas.Card, status_code=201)
def create_card(
    list_id: int,
    payload: schemas.CardCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Adds a card to the bottom of a list. Title is the only requirement."""
    board_list, board, _role = _list_for(db, user, list_id, need=WRITE_ROLES)

    card = models.Card(
        list_id=board_list.id,
        title=_clean(payload.title, "Title"),
        description=_clean_optional(payload.description),
        due_at=payload.due_at,
        start_at=payload.start_at,
        source=payload.source,
        position=_next_position(db, board_list.id),
        created_by_user_id=user.id,
    )
    db.add(card)
    db.flush()

    if payload.label_ids:
        _apply_labels(db, board, card, payload.label_ids)
    if payload.assignee_ids:
        _apply_assignees(db, board, card, payload.assignee_ids)

    db.commit()
    db.refresh(card)
    return _card_payload(card, 0)


@elements_router.get("/cards/{card_id}", response_model=schemas.CardDetail)
def read_card(
    card_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    card, _list, _board, _role = _card_for(db, user, card_id)
    return _card_detail_payload(card)


@elements_router.patch("/cards/{card_id}", response_model=schemas.CardDetail)
def update_card(
    card_id: int,
    payload: schemas.CardUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Edits a card. Absent fields are left alone; explicit nulls clear them.

    `is_complete` is the card's own done-ness and nothing more. It writes no
    ledger row and awards no points — those belong to the `tasks` table, and a
    board where ticking a checkbox quietly moved the leaderboard would make both
    numbers untrustworthy.
    """
    card, _list, board, _role = _card_for(db, user, card_id, need=WRITE_ROLES)
    fields = payload.model_fields_set

    if payload.title is not None:
        card.title = _clean(payload.title, "Title")
    if "description" in fields:
        card.description = _clean_optional(payload.description)
    if "due_at" in fields:
        card.due_at = payload.due_at
    if "start_at" in fields:
        card.start_at = payload.start_at
    if payload.is_complete is not None:
        card.completed_at = get_ist_now() if payload.is_complete else None
    if "label_ids" in fields:
        _apply_labels(db, board, card, payload.label_ids or [])
    if "assignee_ids" in fields:
        _apply_assignees(db, board, card, payload.assignee_ids or [])

    if card.start_at and card.due_at and card.start_at > card.due_at:
        raise HTTPException(status_code=400, detail="A card cannot start after it is due")

    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


@elements_router.patch("/cards/{card_id}/move", response_model=schemas.Card)
def move_card(
    card_id: int,
    payload: schemas.CardMove,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """A drop: the card lands in `list_id` at index `position`.

    Both lists are renumbered in one transaction, so a drag can never leave the
    card counted in two columns. Cross-board moves are refused — the target list
    is resolved through the same board as the card, and a card carrying labels
    from one board into another would arrive referencing rows that do not apply.
    """
    card, source_list, board, _role = _card_for(db, user, card_id, need=WRITE_ROLES)

    target = (
        db.query(models.BoardList)
        .filter(models.BoardList.id == payload.list_id, models.BoardList.board_id == board.id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="List not found on this board")

    remaining = [
        other.id
        for other in db.query(models.Card)
        .filter(models.Card.list_id == target.id, models.Card.id != card.id)
        .order_by(models.Card.position, models.Card.id)
        .all()
    ]
    index = max(0, min(payload.position, len(remaining)))
    remaining.insert(index, card.id)

    card.list_id = target.id
    db.flush()
    _reindex(db, target.id, remaining)

    if source_list.id != target.id:
        survivors = [
            other.id
            for other in db.query(models.Card)
            .filter(models.Card.list_id == source_list.id)
            .order_by(models.Card.position, models.Card.id)
            .all()
        ]
        _reindex(db, source_list.id, survivors)

    db.commit()
    db.refresh(card)
    return _card_payload(card)


@elements_router.delete("/cards/{card_id}")
def delete_card(
    card_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Moves the card to Trash, or deletes it outright if it is already there.

    Two behaviours behind one verb because that is what people mean by delete: the
    first press should be recoverable and the second final. Boards with no Trash
    list — the owner deleted it — delete immediately, since there is nowhere to
    put a tombstone and inventing one silently would lose the card either way.

    A card linked to a Google Calendar event takes the event with it on the
    final delete. That has to happen *here* rather than in the next sync, and it
    is the only card disappearance the sync cannot work out for itself: the row
    is about to be destroyed along with the `google_event_id` that names the
    event, so a sync afterwards would find an event with no card and import it
    back. See calendar_sync/sync.py's `forget_card`. The trash branch below
    needs no such call — the row survives, and the sync deletes the event when
    it next sees a linked card sitting in Trash.
    """
    card, source_list, board, _role = _card_for(db, user, card_id, need=WRITE_ROLES)

    trash = next(
        (lst for lst in board.lists if lst.role == "trash" and lst.archived_at is None), None
    )
    if trash is None or source_list.id == trash.id:
        if card.google_event_id:
            # Imported here rather than at module scope: calendar_sync imports
            # this router for `personal_board`, so a top-level import either way
            # round would be a cycle.
            from app.modules.calendar_sync.sync import forget_card

            forget_card(db, board, card)
        db.delete(card)
        db.commit()
        return {"message": "Card deleted", "card_id": card_id, "trashed": False}

    card.list_id = trash.id
    card.position = _next_position(db, trash.id)
    db.commit()
    return {"message": "Card moved to Trash", "card_id": card_id, "trashed": True}


# --- Checklist ---------------------------------------------------------------

@elements_router.post("/cards/{card_id}/checklist", response_model=schemas.CardDetail, status_code=201)
def add_checklist_item(
    card_id: int,
    payload: schemas.ChecklistItemCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Returns the whole card, so the "0/1" badge and the panel agree at once."""
    card, _list, _board, _role = _card_for(db, user, card_id, need=WRITE_ROLES)
    highest = max((item.position for item in card.checklist), default=0)
    db.add(
        models.ChecklistItem(
            card_id=card.id,
            text=_clean(payload.text, "Checklist item"),
            position=highest + models.POSITION_STEP,
        )
    )
    card.updated_at = get_ist_now()
    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


@elements_router.patch("/checklist/{item_id}", response_model=schemas.CardDetail)
def update_checklist_item(
    item_id: int,
    payload: schemas.ChecklistItemUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    item = db.query(models.ChecklistItem).filter(models.ChecklistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    card, _list, _board, _role = _card_for(db, user, item.card_id, need=WRITE_ROLES)

    if payload.text is not None:
        item.text = _clean(payload.text, "Checklist item")
    if payload.is_done is not None:
        item.is_done = payload.is_done
    card.updated_at = get_ist_now()
    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


@elements_router.delete("/checklist/{item_id}", response_model=schemas.CardDetail)
def delete_checklist_item(
    item_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    item = db.query(models.ChecklistItem).filter(models.ChecklistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    card, _list, _board, _role = _card_for(db, user, item.card_id, need=WRITE_ROLES)
    db.delete(item)
    card.updated_at = get_ist_now()
    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


# --- Labels ------------------------------------------------------------------

@router.post("/{board_id}/labels", response_model=schemas.Label, status_code=201)
def create_label(
    board_id: int,
    payload: schemas.LabelCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    board, _role = _board_for(db, user, board_id, need=WRITE_ROLES)
    label = models.Label(
        board_id=board.id,
        name=_clean_optional(payload.name, MAX_TITLE_LENGTH),
        color=_clean(payload.color, "Colour", 32),
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@elements_router.patch("/labels/{label_id}", response_model=schemas.Label)
def update_label(
    label_id: int,
    payload: schemas.LabelUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    label = db.query(models.Label).filter(models.Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    _board_for(db, user, label.board_id, need=WRITE_ROLES)

    if "name" in payload.model_fields_set:
        label.name = _clean_optional(payload.name, MAX_TITLE_LENGTH)
    if payload.color is not None:
        label.color = _clean(payload.color, "Colour", 32)
    db.commit()
    db.refresh(label)
    return label


@elements_router.delete("/labels/{label_id}")
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Deletes a label and takes it off every card that carried it."""
    label = db.query(models.Label).filter(models.Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    _board_for(db, user, label.board_id, need=ADMIN_ROLES)
    db.delete(label)
    db.commit()
    return {"message": "Label deleted", "label_id": label_id}


# --- Comments ----------------------------------------------------------------

@elements_router.post("/cards/{card_id}/comments", response_model=schemas.CardDetail, status_code=201)
def add_comment(
    card_id: int,
    payload: schemas.CommentCreate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    card, _list, _board, _role = _card_for(db, user, card_id, need=WRITE_ROLES)
    db.add(
        models.Comment(
            card_id=card.id,
            user_id=user.id,
            text=_clean(payload.text, "Comment", MAX_TEXT_LENGTH),
        )
    )
    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


@elements_router.delete("/comments/{comment_id}", response_model=schemas.CardDetail)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Deletes your own comment. Board admins may delete anyone's."""
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    card, _list, _board, role = _card_for(db, user, comment.card_id, need=WRITE_ROLES)
    if comment.user_id != user.id and role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="That is somebody else's comment")
    db.delete(comment)
    db.commit()
    db.refresh(card)
    return _card_detail_payload(card)


# --- Calendar ----------------------------------------------------------------

@router.get("/{board_id}/calendar", response_model=List[schemas.CalendarCard])
def read_calendar(
    board_id: int,
    start: datetime = Query(..., description="Inclusive lower bound on due_at"),
    end: datetime = Query(..., description="Exclusive upper bound on due_at"),
    db: Session = Depends(get_db),
    user=Depends(require_permission("boards.write")),
):
    """Dated cards in a window, for the Planner grid.

    Every card with a due date, not only the ones in the Calendar list: a card
    parked in Next Actions with a time on it is exactly as scheduled as one filed
    under Calendar, and a day grid that hid it would be lying about the day.
    """
    board, _role = _board_for(db, user, board_id)
    if end <= start:
        raise HTTPException(status_code=400, detail="The window ends before it starts")

    list_names = {lst.id: lst.name for lst in board.lists if lst.archived_at is None}
    cards = (
        db.query(models.Card)
        .options(selectinload(models.Card.card_labels).selectinload(models.CardLabel.label))
        .filter(
            models.Card.list_id.in_(list_names.keys()),
            models.Card.due_at.isnot(None),
            models.Card.due_at >= start,
            models.Card.due_at < end,
        )
        .order_by(models.Card.due_at)
        .all()
    )
    return [
        {
            "id": card.id,
            "list_id": card.list_id,
            "list_name": list_names.get(card.list_id, ""),
            "title": card.title,
            "start_at": card.start_at,
            "due_at": card.due_at,
            "completed_at": card.completed_at,
            "labels": _labels_of(card),
        }
        for card in cards
    ]
