"""add user_permissions for admin-controlled feature access

Revision ID: b3c7d1e9a204
Revises: 7f2a91c4b8de
Create Date: 2026-07-30 01:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c7d1e9a204'
down_revision: Union[str, Sequence[str], None] = '7f2a91c4b8de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of the keys every logged-in user could already exercise before
# permissions existed. Deliberately NOT imported from app code: this migration
# must keep doing the same thing even if the catalogue changes later.
LEGACY_MEMBER_PERMISSIONS = (
    "leaderboard.view",
    "tasks.view",
    "tasks.complete",
    "tasks.organize",
    "goals.view",
)


def upgrade() -> None:
    """Create the grants table and preserve what members could already do."""
    op.create_table(
        'user_permissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('permission_key', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'permission_key', name='uq_user_permission'),
    )
    op.create_index(op.f('ix_user_permissions_id'), 'user_permissions', ['id'], unique=False)
    op.create_index(op.f('ix_user_permissions_user_id'), 'user_permissions', ['user_id'], unique=False)
    op.create_index(
        op.f('ix_user_permissions_permission_key'), 'user_permissions', ['permission_key'], unique=False
    )

    # Turning access control on must not silently remove anyone's access. Admins
    # are skipped because the role bypasses permission checks entirely.
    for key in LEGACY_MEMBER_PERMISSIONS:
        op.execute(
            sa.text(
                "INSERT INTO user_permissions (user_id, permission_key) "
                "SELECT id, :key FROM users WHERE COALESCE(role, 'Member') <> 'Admin'"
            ).bindparams(key=key)
        )


def downgrade() -> None:
    """Drop all grants. Access reverts to the previous role-only behaviour."""
    op.drop_index(op.f('ix_user_permissions_permission_key'), table_name='user_permissions')
    op.drop_index(op.f('ix_user_permissions_user_id'), table_name='user_permissions')
    op.drop_index(op.f('ix_user_permissions_id'), table_name='user_permissions')
    op.drop_table('user_permissions')
