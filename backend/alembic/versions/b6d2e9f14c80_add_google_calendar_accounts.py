"""add google calendar connections, and grant calendar.sync

Revision ID: b6d2e9f14c80
Revises: f9a4c2e70b18
Create Date: 2026-08-16 12:00:00.000000

One table, holding one Google Calendar connection per account. The unique
constraint on `user_id` is the privacy model rather than a nicety - see
modules/calendar_sync/models.py: a grant belongs to a person, never to a board
and never to the installation, so there is no row shape that could let one
account reach another's calendar.

The token columns are Text because they hold Fernet ciphertext rather than the
tokens themselves, which is roughly a third longer than the plaintext and has no
useful maximum. app/core/tokenstore.py sets out why they are encrypted at all;
the short version is that this backend directory already contains half a dozen
`pointsystem.backup-*.db` files, and a refresh token in one of those is a live,
silent grant on somebody's calendar for as long as the file exists.

Purely additive. No existing table is altered - `cards.google_event_id` was
created by f9a4c2e70b18 in anticipation of exactly this - no task is retagged,
and no ledger row moves. The leaderboard cannot shift as a result.

`calendar.sync` is backfilled to every non-admin account on the same reasoning
capture.write took in d4a2b6f18e93 and boards.write took in f9a4c2e70b18: the
key opens nothing but the holder's own board and a Google account only they can
authorise, so withholding it protects nobody. It grants no access to any
calendar by itself - that still takes an OAuth consent screen, in their own
browser, on their own Google account. Admins bypass permission checks outright
and so are skipped.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6d2e9f14c80'
down_revision: Union[str, Sequence[str], None] = 'f9a4c2e70b18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CALENDAR_PERMISSION = "calendar.sync"

INDEXED_COLUMNS = ("id", "user_id")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    # Table and indexes guarded separately, for the reason every migration since
    # c2f8b1d40a37 documents: SQLite will not roll back a CREATE TABLE when a
    # later statement in the same migration fails, so one combined guard would
    # see the table present on the retry and skip its missing indexes forever.
    if not _has_table("google_accounts"):
        op.create_table(
            "google_accounts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("google_email", sa.String(), nullable=True),
            # Ciphertext, not tokens. Never selected into a response.
            sa.Column("access_token", sa.Text(), nullable=True),
            sa.Column("refresh_token", sa.Text(), nullable=True),
            sa.Column("token_expires_at", sa.DateTime(), nullable=True),
            sa.Column("scope", sa.Text(), nullable=True),
            sa.Column("calendar_id", sa.String(), nullable=False, server_default="primary"),
            sa.Column("calendar_name", sa.String(), nullable=True),
            sa.Column("pull_enabled", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("push_enabled", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("past_days", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("future_days", sa.Integer(), nullable=False, server_default="90"),
            sa.Column("last_sync_at", sa.DateTime(), nullable=True),
            sa.Column("last_sync_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            # One connection per account. Enforced here and not only in the
            # router, because "two live grants for one person" has no sensible
            # answer to "which calendar is yours?" and a constraint is the only
            # thing that makes the state unreachable.
            sa.UniqueConstraint("user_id", name="uq_google_account_user"),
        )

    if _has_table("google_accounts"):
        existing = _indexes("google_accounts")
        for column in INDEXED_COLUMNS:
            name = op.f(f"ix_google_accounts_{column}")
            if name not in existing:
                op.create_index(name, "google_accounts", [column], unique=False)

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
        ).bindparams(key=CALENDAR_PERMISSION)
    )


def downgrade() -> None:
    """Drops every stored connection and the grant that opened them.

    The tokens go with the table, which is the correct direction: reversing this
    migration means the code that could refresh them is gone too, so keeping
    them would leave unusable credentials lying in a database forever.

    Cards are deliberately left alone. Ones imported from a calendar are
    ordinary cards by now - moved, commented on, worked from - and a schema
    rollback is no reason to delete somebody's week. Their `google_event_id`
    values are also left in place: the column predates this migration and
    outlives it, and a stale id harms nothing while no sync is running.
    """
    op.execute(
        sa.text("DELETE FROM user_permissions WHERE permission_key = :key")
        .bindparams(key=CALENDAR_PERMISSION)
    )

    if _has_table("google_accounts"):
        existing = _indexes("google_accounts")
        for column in INDEXED_COLUMNS:
            name = op.f(f"ix_google_accounts_{column}")
            if name in existing:
                op.drop_index(name, table_name="google_accounts")
        op.drop_table("google_accounts")
