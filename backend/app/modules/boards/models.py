"""MyUniverse: the Kanban surface that holds the whole GTD workflow at once.

Where `inbox_items` and the three holding lists in `buckets` each model one
*stage* of GTD with a table shaped exactly to that stage, this module models the
*workspace* — a board of ordered lists of ordered cards, Trello-shaped, which is
what people actually look at while working. The two coexist on purpose:

    inbox_items / buckets   the method's stages, each with the fields that stage
                            requires and nothing else. Capture stays one text
                            box; a waiting item cannot exist without a delegate.
    boards / lists / cards  one canvas where a card can carry a due date, a
                            checklist, labels and comments, and can be dragged
                            from Inbox to Next Actions without changing type.

A card is therefore generic where a bucket row is specific, and that genericity
is bought deliberately: dragging is only cheap if the thing being dragged does
not have to be converted on the way. Lists are data, not an enum — the seeded
GTD template is a starting arrangement its owner is free to rename, reorder or
delete, because a fixed structure is the thing people abandon a board over.

Privacy works the same way as the inbox: a personal board belongs to exactly one
account, and every read in router.py resolves the board through that ownership
check rather than trusting an id from the client. Team boards are the only place
another account appears, and only through an explicit `board_members` row.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.base import Base
# One clock for the whole app, owned by the ledger that first needed it. A card's
# "today" and a completed task's "today" must never disagree.
from app.modules.tasks.models import get_ist_now


#: Personal boards get this name. Not enforced — it is only the seed.
PERSONAL_BOARD_NAME = "MyUniverse"

#: The GTD template, in rail order: (name, role).
#:
#: `role` is a stable slug the UI keys behaviour off — which list the Planner
#: reads, which one the Inbox pane writes into, which one holds soft-deleted
#: cards. It is *not* a type: a card in "calendar" is the same row as a card in
#: "stuff", and moving it between them is a position change and nothing more.
#: Roles survive a rename, which is why the UI cannot key off `name`.
DEFAULT_LISTS = (
    ("Inbox", "inbox"),
    ("Projects", "projects"),
    ("Project Plans", "project_plans"),
    ("Next Actions", "next_actions"),
    ("Calendar", "calendar"),
    ("Waiting/Delegate", "waiting"),
    ("Stuff", "stuff"),
    ("Reference", "reference"),
    ("Someday/Maybe", "someday"),
    ("Trash", "trash"),
    ("Needs to Cultivate", None),
    ("Bank for AI Agents", None),
)

#: How far apart consecutive positions are seeded and appended.
#:
#: Gapped rather than 0,1,2… so an insert between two cards is one UPDATE
#: instead of renumbering the column. Reorder still rewrites the whole list —
#: see router.py — but a plain drop at the end never has to.
POSITION_STEP = 1000


class Board(Base):
    """A collection of lists. One personal board per account, plus team boards."""
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    #: The owner, for a personal board. Null on a team board, whose access is
    #: carried entirely by `board_members` — a team board with a private owner
    #: would be two access rules for one question.
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    #: "personal" or "team". Not just derivable from owner_user_id being null,
    #: because it also decides whether the GTD template is seeded and whether the
    #: UI offers assignees at all.
    board_type = Column(String, nullable=False, server_default="personal", default="personal", index=True)
    #: Days a card sits in the Trash list before it is purged. Configurable per
    #: board because "throw it away" means different things to a person clearing
    #: an inbox and to a team keeping an audit trail. Null disables purging.
    trash_purge_days = Column(Integer, nullable=True, server_default="30", default=30)
    created_at = Column(DateTime, default=get_ist_now, nullable=False)

    owner = relationship("app.modules.users.models.User")
    lists = relationship(
        "BoardList",
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="BoardList.position",
    )
    labels = relationship("Label", back_populates="board", cascade="all, delete-orphan")
    members = relationship("BoardMember", back_populates="board", cascade="all, delete-orphan")


class BoardList(Base):
    """A column. Ordered, renameable, and archivable rather than special."""
    __tablename__ = "board_lists"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0, index=True)
    #: See DEFAULT_LISTS. Null on any list the owner added themselves.
    role = Column(String, nullable=True, index=True)
    #: True for the seeded twelve. Purely informational — it grants the list no
    #: protection, because "you may not delete Someday/Maybe" is the kind of rule
    #: that makes people keep their real someday list somewhere else.
    is_system_default = Column(Boolean, nullable=False, server_default="0", default=False)
    #: Archived lists keep their cards and stay out of the board view. Set rather
    #: than deleted when the owner wants the column gone but not its history.
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=get_ist_now, nullable=False)

    board = relationship("Board", back_populates="lists")
    cards = relationship(
        "Card",
        back_populates="board_list",
        cascade="all, delete-orphan",
        order_by="Card.position",
    )


class Card(Base):
    """A task, note or idea. The same row wherever it sits on the board."""
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("board_lists.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    #: Markdown, rendered by the client. Text because a card description is as
    #: often a page of thinking as a sentence.
    description = Column(Text, nullable=True)
    #: What the Planner grid and any future reminder key off. Indexed because the
    #: calendar read is a range scan over exactly this column.
    due_at = Column(DateTime, nullable=True, index=True)
    start_at = Column(DateTime, nullable=True)
    #: Set when the card's checkbox is ticked. A card is not a task in the
    #: `tasks` table and earns no points — this is the board's own done-ness, so
    #: a completed card can still be dragged and read.
    completed_at = Column(DateTime, nullable=True)
    #: The mapping to a Google Calendar event, once that sync lands. Stored now
    #: so the column exists before the first sync writes to it, and unique so a
    #: retried sync cannot fan one event out across two cards.
    google_event_id = Column(String, nullable=True, index=True, unique=True)
    #: "manual" | "email" | "calendar_sync" | "ai_agent" — where the card came
    #: from. Worth a column because a card the system created and a card a person
    #: typed deserve different trust when the two disagree.
    source = Column(String, nullable=False, server_default="manual", default="manual")
    position = Column(Integer, nullable=False, default=0, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=get_ist_now, nullable=False)
    #: Bumped by the router on every mutation, because last-write-wins conflict
    #: resolution against Google needs a local timestamp it can trust.
    updated_at = Column(DateTime, default=get_ist_now, onupdate=get_ist_now, nullable=False)

    board_list = relationship("BoardList", back_populates="cards")
    checklist = relationship(
        "ChecklistItem",
        back_populates="card",
        cascade="all, delete-orphan",
        order_by="ChecklistItem.position",
    )
    comments = relationship(
        "Comment",
        back_populates="card",
        cascade="all, delete-orphan",
        order_by="Comment.created_at",
    )
    card_labels = relationship("CardLabel", back_populates="card", cascade="all, delete-orphan")
    assignees = relationship("CardAssignee", back_populates="card", cascade="all, delete-orphan")


class ChecklistItem(Base):
    """One sub-step. Their done-ratio is the "0/1" badge on the card face."""
    __tablename__ = "checklist_items"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    text = Column(String, nullable=False)
    is_done = Column(Boolean, nullable=False, server_default="0", default=False)
    position = Column(Integer, nullable=False, default=0)

    card = relationship("Card", back_populates="checklist")


class Label(Base):
    """A colour with a name, owned by the board rather than by a card."""
    __tablename__ = "labels"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    #: A hex string the client renders directly. Not an enum: the reference board
    #: uses colour as a private code its owner invented, and an enum would decide
    #: for them how many meanings they are allowed.
    color = Column(String, nullable=False)

    board = relationship("Board", back_populates="labels")
    card_labels = relationship("CardLabel", back_populates="label", cascade="all, delete-orphan")


class CardLabel(Base):
    __tablename__ = "card_labels"
    __table_args__ = (UniqueConstraint("card_id", "label_id", name="uq_card_label"),)

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    label_id = Column(Integer, ForeignKey("labels.id"), nullable=False, index=True)

    card = relationship("Card", back_populates="card_labels")
    label = relationship("Label", back_populates="card_labels")


class CardAssignee(Base):
    """Who is on this card. Only meaningful on a team board."""
    __tablename__ = "card_assignees"
    __table_args__ = (UniqueConstraint("card_id", "user_id", name="uq_card_assignee"),)

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    card = relationship("Card", back_populates="assignees")
    user = relationship("app.modules.users.models.User")


class Comment(Base):
    __tablename__ = "card_comments"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=get_ist_now, nullable=False, index=True)

    card = relationship("Card", back_populates="comments")
    user = relationship("app.modules.users.models.User")


class BoardMember(Base):
    """Access to a team board. Absent for personal boards, which need no row.

    A personal board deliberately has no membership table entry, so "is this
    mine?" is one comparison against `owner_user_id` and cannot be granted by
    accident through a stray join row.
    """
    __tablename__ = "board_members"
    __table_args__ = (UniqueConstraint("board_id", "user_id", name="uq_board_member"),)

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    #: "admin" | "member" | "viewer".
    role = Column(String, nullable=False, server_default="member", default="member")

    board = relationship("Board", back_populates="members")
    user = relationship("app.modules.users.models.User")
