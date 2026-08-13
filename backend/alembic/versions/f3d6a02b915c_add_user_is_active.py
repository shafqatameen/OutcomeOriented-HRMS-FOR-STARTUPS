"""add users.is_active so accounts can be deactivated instead of deleted

Revision ID: f3d6a02b915c
Revises: b3c7d1e9a204
Create Date: 2026-08-11 23:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3d6a02b915c'
down_revision: Union[str, Sequence[str], None] = 'b3c7d1e9a204'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_is_active() -> bool:
    """Whether users.is_active is already present on this database."""
    columns = sa.inspect(op.get_bind()).get_columns('users')
    return any(column['name'] == 'is_active' for column in columns)


def upgrade() -> None:
    """Add the flag, unless this database already carries it.

    The existence check is not defensive padding. A migration generated locally
    and deleted before it was ever committed already added this exact column on
    at least one developer database, leaving `alembic_version` stamped at the
    orphan revision e4a1c8f39b62. Those databases were re-stamped by hand to
    b3c7d1e9a204, so this migration is the next thing they run - and a plain
    add_column would abort with "duplicate column name: is_active" on precisely
    the machines that most need to move forward.
    """
    if _has_is_active():
        return

    # Server-side default so the ADD COLUMN can be NOT NULL against existing
    # rows: everyone who already has an account stays active.
    op.add_column(
        'users',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
    )


def downgrade() -> None:
    """Drop the flag. Every account becomes active again by definition."""
    if not _has_is_active():
        return

    # Batch mode because older SQLite cannot DROP COLUMN in place and alembic
    # has to rebuild the table instead.
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('is_active')
