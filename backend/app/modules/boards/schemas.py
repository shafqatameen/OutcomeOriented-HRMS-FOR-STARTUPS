from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel

CardSource = Literal["manual", "email", "calendar_sync", "ai_agent"]
BoardRole = Literal["admin", "member", "viewer"]


# --- Checklist ---------------------------------------------------------------

class ChecklistItemCreate(BaseModel):
    text: str


class ChecklistItemUpdate(BaseModel):
    text: Optional[str] = None
    is_done: Optional[bool] = None


class ChecklistItem(BaseModel):
    id: int
    text: str
    is_done: bool
    position: int

    class Config:
        from_attributes = True


# --- Labels ------------------------------------------------------------------

class LabelCreate(BaseModel):
    color: str
    name: Optional[str] = None


class LabelUpdate(BaseModel):
    color: Optional[str] = None
    name: Optional[str] = None


class Label(BaseModel):
    id: int
    name: Optional[str] = None
    color: str

    class Config:
        from_attributes = True


# --- Comments ----------------------------------------------------------------

class CommentCreate(BaseModel):
    text: str


class Comment(BaseModel):
    id: int
    text: str
    user_id: int
    #: Denormalised for display so the board does not need a second round trip
    #: to turn every comment into a name.
    user_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# --- Cards -------------------------------------------------------------------

class CardCreate(BaseModel):
    """Title-only is the intended shape.

    Everything else is optional because the "Add a card" affordance has to stay a
    single text box — a create form that asks for a due date is a create form
    people stop using, which is the same argument the inbox makes in its own
    models.py.
    """
    title: str
    description: Optional[str] = None
    due_at: Optional[datetime] = None
    start_at: Optional[datetime] = None
    source: CardSource = "manual"
    label_ids: Optional[List[int]] = None
    assignee_ids: Optional[List[int]] = None


class CardUpdate(BaseModel):
    """Partial update. Absent means "leave alone"; null means "clear it".

    The two have to be distinguishable or a due date could never be removed, so
    the router reads `model_fields_set` rather than testing for None.
    """
    title: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[datetime] = None
    start_at: Optional[datetime] = None
    is_complete: Optional[bool] = None
    label_ids: Optional[List[int]] = None
    assignee_ids: Optional[List[int]] = None


class CardMove(BaseModel):
    """A drop. `position` is the destination index within the target list.

    An index rather than a sort key, because that is what the UI knows: the drop
    happened above the third card. The router turns it into positions.
    """
    list_id: int
    position: int


class CardAssignee(BaseModel):
    user_id: int
    user_name: Optional[str] = None


class Card(BaseModel):
    id: int
    list_id: int
    title: str
    description: Optional[str] = None
    due_at: Optional[datetime] = None
    start_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    google_event_id: Optional[str] = None
    source: str
    position: int
    created_at: datetime
    updated_at: datetime
    checklist: List[ChecklistItem] = []
    labels: List[Label] = []
    assignees: List[CardAssignee] = []
    #: The badge on the card face, so the board view never has to load comments
    #: it is not going to show.
    comment_count: int = 0

    class Config:
        from_attributes = True


class CardDetail(Card):
    """A card with its conversation. Only the detail panel asks for this."""
    comments: List[Comment] = []


# --- Lists -------------------------------------------------------------------

class BoardListCreate(BaseModel):
    name: str


class BoardListUpdate(BaseModel):
    name: Optional[str] = None
    is_archived: Optional[bool] = None


class ListReorder(BaseModel):
    list_ids: List[int]


class BoardList(BaseModel):
    id: int
    name: str
    position: int
    role: Optional[str] = None
    is_system_default: bool
    cards: List[Card] = []

    class Config:
        from_attributes = True


# --- Boards ------------------------------------------------------------------

class BoardCreate(BaseModel):
    name: str
    #: A team board is blank by default — see README. Set true to seed the same
    #: twelve GTD lists a personal board gets.
    use_gtd_template: bool = False
    member_ids: List[int] = []


class BoardUpdate(BaseModel):
    name: Optional[str] = None
    trash_purge_days: Optional[int] = None


class BoardMemberUpdate(BaseModel):
    user_id: int
    role: BoardRole


class BoardMember(BaseModel):
    user_id: int
    user_name: Optional[str] = None
    role: str


class BoardSummary(BaseModel):
    """Enough for the board switcher, without loading anybody's cards."""
    id: int
    name: str
    board_type: str
    owner_user_id: Optional[int] = None
    #: This account's authority on this board: "owner" on a personal board,
    #: otherwise the membership role. Sent so the client can hide controls it is
    #: going to be refused anyway.
    my_role: str
    card_count: int = 0

    class Config:
        from_attributes = True


class Board(BaseModel):
    id: int
    name: str
    board_type: str
    owner_user_id: Optional[int] = None
    trash_purge_days: Optional[int] = None
    my_role: str
    lists: List[BoardList] = []
    labels: List[Label] = []
    members: List[BoardMember] = []

    class Config:
        from_attributes = True


# --- Calendar ----------------------------------------------------------------

class CalendarCard(BaseModel):
    """A dated card, flattened for the Planner grid."""
    id: int
    list_id: int
    list_name: str
    title: str
    start_at: Optional[datetime] = None
    due_at: datetime
    completed_at: Optional[datetime] = None
    labels: List[Label] = []

    class Config:
        from_attributes = True
