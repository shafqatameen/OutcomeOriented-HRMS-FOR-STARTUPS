"""add inbox_items, and grant capture.write to every existing account

Revision ID: d4a2b6f18e93
Revises: c2f8b1d40a37
Create Date: 2026-08-15 12:00:00.000000

The capture step of GTD: somewhere for an open loop to land before anybody has
decided what it is. The table holds an owner, some text and a timestamp, and
nothing else - see modules/inbox/models.py for why that emptiness is the design
rather than a first draft of one.

Nothing existing is touched. No column is added to `tasks`, no task is retagged,
no ledger row moves, and the leaderboard cannot shift as a result of this
migration. It only adds a table and inserts permission grants.

The grant backfill is what makes the feature exist for the people already in the
database. `capture.write` opens your own inbox and nothing else, so handing it
to every account gives nobody sight of anybody else's work; withholding it would
only mean a live account that cannot use the feature until an administrator
notices. Admins are skipped because the role bypasses permission checks outright.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a2b6f18e93'
down_revision: Union[str, Sequence[str], None] = 'c2f8b1d40a37'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE_NAME = "inbox_items"

# Frozen, and deliberately NOT imported from app.modules.auth.permissions: this
# migration has to keep granting exactly this key even after the catalogue
# changes shape later, the same way b3c7d1e9a204 froze its own list.
CAPTURE_PERMISSION = "capture.write"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    # Table and indexes are guarded independently, for the reason c2f8b1d40a37
    # documents: SQLite does not roll a CREATE TABLE back when a later statement
    # in the same migration fails, so a single combined guard would see the table
    # present on the retry and skip straight past the missing indexes forever.
    if not _has_table(TABLE_NAME):
        op.create_table(
            TABLE_NAME,
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
        )

    existing = _indexes(TABLE_NAME)
    # user_id: every read filters on it, because an inbox is only ever your own.
    # created_at: every read sorts on it, because clarifying works oldest first.
    for index_name, column in (
        (op.f('ix_inbox_items_id'), 'id'),
        (op.f('ix_inbox_items_user_id'), 'user_id'),
        (op.f('ix_inbox_items_created_at'), 'created_at'),
    ):
        if index_name not in existing:
            op.create_index(index_name, TABLE_NAME, [column], unique=False)

    # NOT EXISTS rather than a bare INSERT ... SELECT: uq_user_permission would
    # otherwise abort the whole statement if any account already holds the key,
    # which is exactly the state a half-applied run leaves behind.
    op.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, permission_key) "
            "SELECT u.id, :key FROM users u "
            "WHERE COALESCE(u.role, 'Member') <> 'Admin' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM user_permissions p "
            "  WHERE p.user_id = u.id AND p.permission_key = :key"
            ")"
        ).bindparams(key=CAPTURE_PERMISSION)
    )


def downgrade() -> None:
    """Drops the inbox and the grants that opened it.

    Captured items are destroyed with the table. There is nowhere to put them:
    an inbox item has no equivalent anywhere else in the schema - that is the
    whole reason this table was added - and turning them into tasks would invent
    a category, an assignee and a point value that nobody ever chose.
    """
    op.execute(
        sa.text("DELETE FROM user_permissions WHERE permission_key = :key")
        .bindparams(key=CAPTURE_PERMISSION)
    )

    if _has_table(TABLE_NAME):
        existing = _indexes(TABLE_NAME)
        for index_name in (
            op.f('ix_inbox_items_created_at'),
            op.f('ix_inbox_items_user_id'),
            op.f('ix_inbox_items_id'),
        ):
            if index_name in existing:
                op.drop_index(index_name, table_name=TABLE_NAME)
        op.drop_table(TABLE_NAME)
