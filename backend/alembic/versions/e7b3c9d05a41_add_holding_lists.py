"""add someday, reference and waiting lists, and grant lists.write

Revision ID: e7b3c9d05a41
Revises: d4a2b6f18e93
Create Date: 2026-08-15 14:00:00.000000

The three holding lists an inbox item can be clarified into. Three tables and
not one, for the reason modules/buckets/models.py sets out: a shared table would
have to make every column nullable, and would then happily store a waiting item
with nobody to wait on.

Purely additive. No existing table is altered, no task is retagged, no ledger
row moves. The leaderboard cannot shift as a result of this migration.

`lists.write` is backfilled to every non-admin account on the same reasoning as
capture.write in d4a2b6f18e93: these lists are private to their owner and create
nothing anybody else can see, so withholding the key protects nothing and would
only leave a live account unable to file what it has already captured. Admins
bypass permission checks outright and so are skipped.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7b3c9d05a41'
down_revision: Union[str, Sequence[str], None] = 'd4a2b6f18e93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LISTS_PERMISSION = "lists.write"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


# (table, [columns...]) — created only if absent, each guarded on its own.
INDEXES = {
    "someday_items": ("id", "user_id", "created_at"),
    "reference_items": ("id", "user_id", "created_at"),
    "waiting_items": (
        "id", "user_id", "delegate_user_id", "waiting_since", "follow_up_date", "status",
    ),
}


def upgrade() -> None:
    # Tables and indexes guarded independently throughout, for the reason
    # c2f8b1d40a37 and d4a2b6f18e93 both document: SQLite will not roll back a
    # CREATE TABLE when a later statement in the same migration fails, so a
    # single combined guard would see the table present on the retry and skip
    # past its missing indexes permanently.
    if not _has_table("someday_items"):
        op.create_table(
            "someday_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_reviewed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("reference_items"):
        op.create_table(
            "reference_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("waiting_items"):
        op.create_table(
            "waiting_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("delegate_user_id", sa.Integer(), nullable=True),
            # Not nullable: this column is what makes the row a waiting item.
            sa.Column("delegate_name", sa.String(), nullable=False),
            sa.Column("waiting_since", sa.DateTime(), nullable=False),
            sa.Column("follow_up_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="Open"),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["delegate_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    for table, columns in INDEXES.items():
        existing = _indexes(table)
        for column in columns:
            name = op.f(f"ix_{table}_{column}")
            if name not in existing:
                op.create_index(name, table, [column], unique=False)

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
        ).bindparams(key=LISTS_PERMISSION)
    )


def downgrade() -> None:
    """Drops the three lists and the grant that opened them.

    Their contents go with them. Nothing here has an equivalent elsewhere in the
    schema — that is why the tables were added — and turning a someday item into
    a task would invent a commitment its owner deliberately never made.
    """
    op.execute(
        sa.text("DELETE FROM user_permissions WHERE permission_key = :key")
        .bindparams(key=LISTS_PERMISSION)
    )

    for table, columns in INDEXES.items():
        if not _has_table(table):
            continue
        existing = _indexes(table)
        for column in columns:
            name = op.f(f"ix_{table}_{column}")
            if name in existing:
                op.drop_index(name, table_name=table)
        op.drop_table(table)
