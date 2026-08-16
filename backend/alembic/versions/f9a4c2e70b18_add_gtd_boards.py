"""add MyUniverse boards, lists, cards and their parts

Revision ID: f9a4c2e70b18
Revises: e7b3c9d05a41
Create Date: 2026-08-16 10:00:00.000000

The Kanban surface described in modules/boards/models.py. Purely additive: no
existing table is altered, no task is retagged, no ledger row moves, so the
leaderboard cannot shift as a result of this migration.

No board is seeded here. Personal boards are provisioned on first read instead
(see boards/router.py `personal_board`), which keeps this migration cheap on a
database with many accounts and means an account that never opens MyUniverse
never gets twelve empty lists it did not ask for.

`boards.write` is backfilled to every non-admin account on the reasoning
capture.write and lists.write were, in d4a2b6f18e93 and e7b3c9d05a41: a personal
board is private to its owner and creates nothing anybody else can see, so
withholding the key protects nothing and would only leave a live account unable
to organise what it has already captured. `boards.team` is deliberately *not*
backfilled — a shared board is visible to other people, so it stays a grant an
administrator makes on purpose. Admins bypass permission checks outright and so
are skipped by both.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f9a4c2e70b18'
down_revision: Union[str, Sequence[str], None] = 'e7b3c9d05a41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BOARDS_PERMISSION = "boards.write"
#: Both keys are removed on downgrade; only the first is granted on upgrade.
PERMISSION_KEYS = (BOARDS_PERMISSION, "boards.team")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


# (table, [columns...]) — each index created only if absent, guarded on its own.
INDEXES = {
    "boards": ("id", "owner_user_id", "board_type"),
    "board_lists": ("id", "board_id", "position", "role"),
    "cards": (
        "id", "list_id", "due_at", "position", "created_by_user_id",
    ),
    "checklist_items": ("id", "card_id"),
    "labels": ("id", "board_id"),
    "card_labels": ("id", "card_id", "label_id"),
    "card_assignees": ("id", "card_id", "user_id"),
    "card_comments": ("id", "card_id", "user_id", "created_at"),
    "board_members": ("id", "board_id", "user_id"),
}

#: Unique indexes, kept apart because they are created with unique=True and
#: dropped by the same names.
UNIQUE_INDEXES = {
    "cards": ("google_event_id",),
}

#: Creation order matters: every table below references the ones above it.
TABLE_ORDER = (
    "boards",
    "board_lists",
    "cards",
    "checklist_items",
    "labels",
    "card_labels",
    "card_assignees",
    "card_comments",
    "board_members",
)


def upgrade() -> None:
    # Every table and index is guarded independently, for the reason
    # c2f8b1d40a37, d4a2b6f18e93 and e7b3c9d05a41 all document: SQLite will not
    # roll back a CREATE TABLE when a later statement in the same migration
    # fails, so one combined guard would find the first table present on the
    # retry and skip permanently past everything after it.
    if not _has_table("boards"):
        op.create_table(
            "boards",
            sa.Column("id", sa.Integer(), nullable=False),
            # Null on a team board, whose access lives entirely in board_members.
            sa.Column("owner_user_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("board_type", sa.String(), nullable=False, server_default="personal"),
            sa.Column("trash_purge_days", sa.Integer(), nullable=True, server_default="30"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("board_lists"):
        op.create_table(
            "board_lists",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("board_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            # The stable slug the UI keys behaviour off, so a rename cannot
            # detach the Planner from the Calendar column.
            sa.Column("role", sa.String(), nullable=True),
            sa.Column("is_system_default", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("archived_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["board_id"], ["boards.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("cards"):
        op.create_table(
            "cards",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("list_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("due_at", sa.DateTime(), nullable=True),
            sa.Column("start_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            # Reserved for the Google Calendar sync. Created now because it is
            # the mapping column that has to exist before the first sync writes,
            # and unique so a retry cannot fan one event across two cards.
            sa.Column("google_event_id", sa.String(), nullable=True),
            sa.Column("source", sa.String(), nullable=False, server_default="manual"),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["list_id"], ["board_lists.id"]),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("checklist_items"):
        op.create_table(
            "checklist_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("card_id", sa.Integer(), nullable=False),
            sa.Column("text", sa.String(), nullable=False),
            sa.Column("is_done", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["card_id"], ["cards.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("labels"):
        op.create_table(
            "labels",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("board_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("color", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["board_id"], ["boards.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("card_labels"):
        op.create_table(
            "card_labels",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("card_id", sa.Integer(), nullable=False),
            sa.Column("label_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["card_id"], ["cards.id"]),
            sa.ForeignKeyConstraint(["label_id"], ["labels.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("card_id", "label_id", name="uq_card_label"),
        )

    if not _has_table("card_assignees"):
        op.create_table(
            "card_assignees",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("card_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["card_id"], ["cards.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("card_id", "user_id", name="uq_card_assignee"),
        )

    if not _has_table("card_comments"):
        op.create_table(
            "card_comments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("card_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["card_id"], ["cards.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("board_members"):
        op.create_table(
            "board_members",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("board_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("role", sa.String(), nullable=False, server_default="member"),
            sa.ForeignKeyConstraint(["board_id"], ["boards.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("board_id", "user_id", name="uq_board_member"),
        )

    for table, columns in INDEXES.items():
        existing = _indexes(table)
        for column in columns:
            name = op.f(f"ix_{table}_{column}")
            if name not in existing:
                op.create_index(name, table, [column], unique=False)

    for table, columns in UNIQUE_INDEXES.items():
        existing = _indexes(table)
        for column in columns:
            name = op.f(f"ix_{table}_{column}")
            if name not in existing:
                op.create_index(name, table, [column], unique=True)

    # NOT EXISTS rather than a bare INSERT ... SELECT, so a re-run after a
    # partial failure does not trip uq_user_permission and abort.
    op.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, permission_key) "
            "SELECT u.id, :key FROM users u "
            "WHERE COALESCE(u.role, 'Member') <> 'Admin' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM user_permissions p "
            "  WHERE p.user_id = u.id AND p.permission_key = :key"
            ")"
        ).bindparams(key=BOARDS_PERMISSION)
    )


def downgrade() -> None:
    """Drops the board tables and the grants that opened them.

    Every card goes with them. A card has no equivalent elsewhere in the schema —
    that is why these tables were added — and turning one into a task would
    invent an assignment and a point value nobody agreed to.
    """
    for key in PERMISSION_KEYS:
        op.execute(
            sa.text("DELETE FROM user_permissions WHERE permission_key = :key")
            .bindparams(key=key)
        )

    # Reverse creation order, so no drop runs while a child still references it.
    for table in reversed(TABLE_ORDER):
        if not _has_table(table):
            continue
        existing = _indexes(table)
        for column in INDEXES.get(table, ()) + UNIQUE_INDEXES.get(table, ()):
            name = op.f(f"ix_{table}_{column}")
            if name in existing:
                op.drop_index(name, table_name=table)
        op.drop_table(table)
