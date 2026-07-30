"""add task position for drag-and-drop ordering

Revision ID: 7f2a91c4b8de
Revises: c99183a40dd4
Create Date: 2026-07-29 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7f2a91c4b8de'
down_revision: Union[str, Sequence[str], None] = 'c99183a40dd4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add tasks.position and seed it from id."""
    op.add_column(
        'tasks',
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index(op.f('ix_tasks_position'), 'tasks', ['position'], unique=False)
    # Every existing row would otherwise tie at 0, and the id tiebreak in
    # read_tasks would be the only thing ordering them. Seeding from id makes the
    # current on-screen order explicit and stable before anyone drags anything.
    op.execute("UPDATE tasks SET position = id")


def downgrade() -> None:
    """Drop tasks.position. Manual ordering is lost; nothing else is touched."""
    op.drop_index(op.f('ix_tasks_position'), table_name='tasks')
    op.drop_column('tasks', 'position')
