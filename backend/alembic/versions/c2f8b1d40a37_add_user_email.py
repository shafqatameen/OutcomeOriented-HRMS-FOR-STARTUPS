"""add users.email as the sign-in identifier

Revision ID: c2f8b1d40a37
Revises: a1c4e07f52bd
Create Date: 2026-08-15 10:00:00.000000

Adds the address people sign in with. Nullable, and left null on every existing
row: there is no honest way to derive somebody's email from their display name,
and inventing one would produce an address that silently fails to receive mail.

Accounts without an address therefore keep signing in by name until an
administrator sets one - see the legacy fallback in modules/auth/router.py. That
fallback is what makes this migration safe to run against a live database: on
its own it would otherwise lock out every existing account.

The unique index is created over a nullable column on purpose. SQLite (and
Postgres) treat NULLs as distinct in a UNIQUE index, so any number of accounts
may sit at null while no two may share a real address.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2f8b1d40a37'
down_revision: Union[str, Sequence[str], None] = 'a1c4e07f52bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "ix_users_email"


def _columns(table: str) -> set:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    # Column and index guarded separately, for the reason a1c4e07f52bd documents:
    # SQLite does not roll back an ADD COLUMN when a later statement in the same
    # migration fails, so a combined guard could leave the index missing forever.
    if "email" not in _columns("users"):
        op.add_column("users", sa.Column("email", sa.String(), nullable=True))
    if INDEX_NAME not in _indexes("users"):
        op.create_index(INDEX_NAME, "users", ["email"], unique=True)


def downgrade() -> None:
    """Drops the address. Anyone who was signing in with it falls back to their
    name, which still works - so this does not lock anybody out either."""
    if INDEX_NAME in _indexes("users"):
        op.drop_index(INDEX_NAME, table_name="users")
    if "email" in _columns("users"):
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("email")
