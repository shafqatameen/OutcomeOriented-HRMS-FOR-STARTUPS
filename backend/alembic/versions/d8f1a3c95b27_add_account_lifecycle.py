"""add self-service account lifecycle: verification, approval, google sign-in

Revision ID: d8f1a3c95b27
Revises: b6d2e9f14c80
Create Date: 2026-08-16 10:00:00.000000

Four objects, each added behind its own existence check. That is not defensive
padding: SQLite runs DDL outside the surrounding transaction, so a migration that
fails on its third statement leaves the first two applied and `alembic_version`
still pointing at the previous revision. The re-run then has to survive finding
half its own work already done, or the database is stuck needing hand surgery.

The backfill is the part worth reading twice. Every account that exists when this
runs is stamped as verified and approved, including deactivated ones. An admin
who typed a colleague's address *is* the verification, and an account that was
switched off was certainly approved before it was switched off - so leaving
either column null would lock out established users at their next sign-in, which
is precisely the flag day this migration exists to avoid.
"""
from datetime import datetime
from typing import Sequence, Union

import pytz
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f1a3c95b27'
down_revision: Union[str, Sequence[str], None] = 'b6d2e9f14c80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _user_columns() -> set:
    return {column['name'] for column in sa.inspect(op.get_bind()).get_columns('users')}


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table: str, name: str) -> bool:
    if not _has_table(table):
        return False
    return any(index['name'] == name for index in sa.inspect(op.get_bind()).get_indexes(table))


def upgrade() -> None:
    columns = _user_columns()

    if 'email_verified_at' not in columns:
        op.add_column('users', sa.Column('email_verified_at', sa.DateTime(), nullable=True))

    if 'approved_at' not in columns:
        op.add_column('users', sa.Column('approved_at', sa.DateTime(), nullable=True))

    if 'google_sub' not in columns:
        op.add_column('users', sa.Column('google_sub', sa.String(), nullable=True))

    # Unique, so two accounts can never claim the same Google identity. Created
    # separately from the column because add_column cannot express it in SQLite.
    if not _has_index('users', 'ix_users_google_sub'):
        op.create_index('ix_users_google_sub', 'users', ['google_sub'], unique=True)

    # --- Backfill -------------------------------------------------------------
    #
    # One timestamp for the whole backfill rather than a per-row CURRENT_TIMESTAMP:
    # these accounts were not verified or approved at any particular moment, and a
    # single value reads honestly as "this is when the concept was introduced"
    # instead of implying a per-account event that never happened.
    #
    # Guarded by `IS NULL` so a re-run after a partial failure cannot overwrite a
    # genuine timestamp recorded by the application in between.
    #
    # Computed in Python rather than with SQLite's datetime('now'), which returns
    # UTC: every other timestamp in this schema is naive IST, and a handful of
    # rows five and a half hours out would be a puzzle for whoever next reads
    # them next to a created_at.
    stamped_at = datetime.now(pytz.timezone('Asia/Kolkata')).replace(tzinfo=None)

    op.execute(
        sa.text(
            "UPDATE users SET approved_at = :at WHERE approved_at IS NULL"
        ).bindparams(at=stamped_at)
    )

    # Only where there is an address to have verified. An account still signing
    # in by name has nothing to prove yet, and stamping it would quietly assert
    # that a null address had been confirmed.
    op.execute(
        sa.text(
            "UPDATE users SET email_verified_at = :at "
            "WHERE email_verified_at IS NULL AND email IS NOT NULL"
        ).bindparams(at=stamped_at)
    )

    # --- One-time links -------------------------------------------------------
    if not _has_table('auth_tokens'):
        op.create_table(
            'auth_tokens',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('purpose', sa.String(), nullable=False),
            # Unique: a collision would mean two accounts sharing one link, and
            # the constraint is free insurance against a broken RNG.
            sa.Column('token_hash', sa.String(), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_index('auth_tokens', 'ix_auth_tokens_token_hash'):
        op.create_index(
            'ix_auth_tokens_token_hash', 'auth_tokens', ['token_hash'], unique=True
        )
    if not _has_index('auth_tokens', 'ix_auth_tokens_user_id'):
        op.create_index('ix_auth_tokens_user_id', 'auth_tokens', ['user_id'])
    if not _has_index('auth_tokens', 'ix_auth_tokens_purpose'):
        op.create_index('ix_auth_tokens_purpose', 'auth_tokens', ['purpose'])
    if not _has_index('auth_tokens', 'ix_auth_tokens_id'):
        op.create_index('ix_auth_tokens_id', 'auth_tokens', ['id'])


def downgrade() -> None:
    """Removes the lifecycle columns and the token table.

    Outstanding verification and reset links stop working, which is the correct
    outcome: there is nowhere left to record that they were spent, so keeping
    them alive would make them replayable.
    """
    if _has_index('auth_tokens', 'ix_auth_tokens_token_hash'):
        op.drop_index('ix_auth_tokens_token_hash', table_name='auth_tokens')
    if _has_index('auth_tokens', 'ix_auth_tokens_user_id'):
        op.drop_index('ix_auth_tokens_user_id', table_name='auth_tokens')
    if _has_index('auth_tokens', 'ix_auth_tokens_purpose'):
        op.drop_index('ix_auth_tokens_purpose', table_name='auth_tokens')
    if _has_index('auth_tokens', 'ix_auth_tokens_id'):
        op.drop_index('ix_auth_tokens_id', table_name='auth_tokens')
    if _has_table('auth_tokens'):
        op.drop_table('auth_tokens')

    if _has_index('users', 'ix_users_google_sub'):
        op.drop_index('ix_users_google_sub', table_name='users')

    columns = _user_columns()
    # Batch mode: older SQLite cannot DROP COLUMN in place, so alembic rebuilds
    # the table instead. One batch for all three, because each batch is a full
    # table copy.
    to_drop = [
        name for name in ('google_sub', 'approved_at', 'email_verified_at')
        if name in columns
    ]
    if to_drop:
        with op.batch_alter_table('users') as batch_op:
            for name in to_drop:
                batch_op.drop_column(name)
