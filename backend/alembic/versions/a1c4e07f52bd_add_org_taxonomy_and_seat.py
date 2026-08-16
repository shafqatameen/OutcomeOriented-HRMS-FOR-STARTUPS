"""add the pillar/function domain axis, the seat, and ledger minutes

Revision ID: a1c4e07f52bd
Revises: f3d6a02b915c
Create Date: 2026-08-14 12:00:00.000000

Adds the second axis every task is tagged on. Categories already answer "is this
moving me forward?" and price the task; pillars and functions answer "what kind
of work is this?". Crossing the two is what the panel exists to show.

Every column added here is nullable, so the databases this runs against - which
already hold tasks, a point ledger and a leaderboard computed from it - come out
the other side unchanged. Nothing is retagged, nothing is repriced.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c4e07f52bd'
down_revision: Union[str, Sequence[str], None] = 'f3d6a02b915c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen seed data, deliberately NOT imported from app code: this migration has
# to keep producing the same taxonomy even after the admin UI starts editing it.
# Colours are the literal cell fills from the source spreadsheet.
#
# (slug, name, color_hex, position, is_company)
PILLARS = (
    ("ceo",      "CEO Pillar",      "#666666", 1, 1),
    ("product",  "Product Pillar",  "#52818b", 2, 1),
    ("customer", "Customer Pillar", "#fadb57", 3, 1),
    ("business", "Business Pillar", "#954f72", 4, 1),
    # Not a company pillar: sleeping eight hours must not dilute the answer to
    # "how much of my *work* was Core".
    ("life",     "Life",            "#00b050", 5, 0),
)

# (pillar_slug, name, purpose, color_hex, position)
FUNCTIONS = (
    ("ceo", "Define Vision & Strategy",
     "Define why the business exists and how it will succeed", "#efefef", 1),
    ("ceo", "Build & Coach Team",
     "Grow the people and yourself - meetings, 1:1s, reading, self-development", "#d9d9d9", 2),
    ("ceo", "Develop Culture",
     "Team activities and core values", "#cccccc", 3),
    ("ceo", "Manage Cashflow",
     "Assess cashflow and analyse financial status", "#b7b7b7", 4),
    ("ceo", "Grow Brand",
     "Networking, partnership meetings, authority building", "#999999", 5),
    ("ceo", "Monitor Progress",
     "CEO dashboard, check targets, analyse targets", "#666666", 6),

    ("product", "R&D",
     "Develop new products and services", "#e6ebec", 1),
    ("product", "Production",
     "Produce products / services", "#aec3c8", 2),
    ("product", "Fulfilment",
     "Deliver products / services - client calls, client meetings, delivery", "#779ba3", 3),

    ("customer", "Marketing",
     "Create awareness and interest", "#fdf8e1", 1),
    ("customer", "Sales",
     "Convert interest and awareness into sales", "#fdf1c3", 2),
    ("customer", "After Sales",
     "Ensure customers are happy", "#fae489", 3),

    ("business", "Admin / Management",
     "Organise and run the day to day activities of the business", "#ede1e7", 1),
    ("business", "Operations",
     "Build effective systems and process to operate", "#e9dae1", 2),
    ("business", "Finance",
     "Financial processing and reporting", "#e4d1da", 3),
    ("business", "Legal",
     "Operate lawfully", "#ddc5d1", 4),
    ("business", "HR",
     "Build the best team and working environment", "#d4b7c5", 5),
    ("business", "Purchasing",
     "Find and work with good suppliers and obtain the resources the company requires",
     "#c9a5b7", 6),
    ("business", "IT",
     "Harness technology to enable the company to operate more effectively and efficiently",
     "#bb8ea5", 7),
    ("business", "Intelligence",
     "Understand the business, its landscape and its customers to make informed decisions",
     "#aa728e", 8),

    # The pillar the spreadsheet does not have and a pre-PMF founder cannot live
    # without. Its own time audit is full of tahajjud, family, hospital, sleep.
    ("life", "Spiritual Practice",
     "Prayer, tahajjud, taraweeh, reflection", "#00b050", 1),
    ("life", "Health & Body",
     "Food, exercise, medical - the body that has to last the whole run", "#38a169", 2),
    ("life", "Family & Relationships",
     "The people, not the company", "#4c9a75", 3),
    ("life", "Rest & Sleep",
     "Actual recovery", "#68b391", 4),
    ("life", "Downtime",
     "Reels, movies, scrolling - the honest bucket", "#8fc7ae", 5),
)

#: The fourth track. Worth zero points on purpose: hours spent here are logged
#: and visible in the minutes column, and earn nothing.
DRAIN_CATEGORY = ("Drain", 0)

#: New key for a surface that did not exist when these accounts were created.
#: Without this backfill, everyone but the admins logs in to a dead nav item.
PANEL_VIEW_KEY = "panel.view"


def _columns(table: str) -> set:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_column_once(table: str, column: sa.Column, index_name: str = "") -> None:
    """Add a column and its index, each only if that exact object is missing.

    Guarded separately rather than as a pair on purpose. The first run of this
    migration added tasks.function_id and then raised before creating its index,
    and SQLite did not roll the ADD COLUMN back - so a guard that skipped the
    index whenever the column existed would have left it missing forever.
    """
    if column.name not in _columns(table):
        op.add_column(table, column)
    if index_name and index_name not in _indexes(table):
        op.create_index(index_name, table, [column.name], unique=False)


def upgrade() -> None:
    existing_tables = _tables()

    if "pillars" not in existing_tables:
        op.create_table(
            "pillars",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("color_hex", sa.String(), nullable=False, server_default="#666666"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_company", sa.Boolean(), nullable=False, server_default="1"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_pillars_id"), "pillars", ["id"], unique=False)
        op.create_index(op.f("ix_pillars_name"), "pillars", ["name"], unique=True)
        op.create_index(op.f("ix_pillars_slug"), "pillars", ["slug"], unique=True)
        op.create_index(op.f("ix_pillars_position"), "pillars", ["position"], unique=False)

    if "functions" not in existing_tables:
        op.create_table(
            "functions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("pillar_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("purpose", sa.Text(), nullable=True),
            sa.Column("color_hex", sa.String(), nullable=False, server_default="#666666"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.ForeignKeyConstraint(["pillar_id"], ["pillars.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_functions_id"), "functions", ["id"], unique=False)
        op.create_index(op.f("ix_functions_pillar_id"), "functions", ["pillar_id"], unique=False)
        op.create_index(op.f("ix_functions_name"), "functions", ["name"], unique=False)
        op.create_index(op.f("ix_functions_position"), "functions", ["position"], unique=False)

    # Added as plain integers, without the REFERENCES clause the models declare.
    # Alembic implements add_column-with-ForeignKey as a separate ADD CONSTRAINT,
    # which SQLite has no syntax for, and the only alternative is a batch
    # copy-and-move rebuild of `tasks` and `users` - a table swap under the point
    # ledger, to gain a constraint this database would not enforce anyway because
    # it runs without PRAGMA foreign_keys (see core.database).
    #
    # The ORM-level ForeignKey in the models is what actually matters: it drives
    # the joins. Referential integrity is enforced where every other one of these
    # relationships enforces it - in the router, via core.integrity.
    _add_column_once(
        "tasks", sa.Column("function_id", sa.Integer(), nullable=True),
        op.f("ix_tasks_function_id"),
    )
    _add_column_once(
        "users", sa.Column("home_function_id", sa.Integer(), nullable=True),
        op.f("ix_users_home_function_id"),
    )
    _add_column_once("point_ledger", sa.Column("minutes", sa.Integer(), nullable=True))

    _seed()


def _seed() -> None:
    """Insert the taxonomy, the Drain track and the panel grant, all idempotently.

    Every statement is guarded by a NOT EXISTS so re-running this on a database
    that was patched by hand adds nothing twice - and so an admin who has since
    renamed or deleted a seeded pillar does not get it silently resurrected on
    the next deploy.
    """
    connection = op.get_bind()

    for slug, name, color_hex, position, is_company in PILLARS:
        connection.execute(
            sa.text(
                "INSERT INTO pillars (name, slug, color_hex, position, is_company) "
                "SELECT :name, :slug, :color, :position, :is_company "
                "WHERE NOT EXISTS (SELECT 1 FROM pillars WHERE slug = :slug)"
            ),
            {
                "name": name, "slug": slug, "color": color_hex,
                "position": position, "is_company": is_company,
            },
        )

    for pillar_slug, name, purpose, color_hex, position in FUNCTIONS:
        connection.execute(
            sa.text(
                "INSERT INTO functions (pillar_id, name, purpose, color_hex, position) "
                "SELECT p.id, :name, :purpose, :color, :position FROM pillars p "
                "WHERE p.slug = :pillar_slug AND NOT EXISTS ("
                "  SELECT 1 FROM functions f WHERE f.pillar_id = p.id AND f.name = :name"
                ")"
            ),
            {
                "pillar_slug": pillar_slug, "name": name, "purpose": purpose,
                "color": color_hex, "position": position,
            },
        )

    drain_name, drain_points = DRAIN_CATEGORY
    connection.execute(
        sa.text(
            "INSERT INTO categories (name, default_points) "
            "SELECT :name, :points "
            "WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = :name)"
        ),
        {"name": drain_name, "points": drain_points},
    )

    # Admins bypass permission checks, so they are skipped for the same reason
    # b3c7d1e9a204 skipped them: a row would be informational only.
    connection.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, permission_key) "
            "SELECT u.id, :key FROM users u "
            "WHERE COALESCE(u.role, 'Member') <> 'Admin' AND NOT EXISTS ("
            "  SELECT 1 FROM user_permissions up "
            "  WHERE up.user_id = u.id AND up.permission_key = :key"
            ")"
        ),
        {"key": PANEL_VIEW_KEY},
    )


def downgrade() -> None:
    """Remove the domain axis. Tracks, points and the ledger are untouched.

    Task function tags and everyone's seat are lost, because both live only in
    the columns being dropped. Logged minutes go with them.
    """
    connection = op.get_bind()
    connection.execute(
        sa.text("DELETE FROM user_permissions WHERE permission_key = :key"),
        {"key": PANEL_VIEW_KEY},
    )

    if "minutes" in _columns("point_ledger"):
        with op.batch_alter_table("point_ledger") as batch_op:
            batch_op.drop_column("minutes")

    if "home_function_id" in _columns("users"):
        op.drop_index(op.f("ix_users_home_function_id"), table_name="users")
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("home_function_id")

    if "function_id" in _columns("tasks"):
        op.drop_index(op.f("ix_tasks_function_id"), table_name="tasks")
        with op.batch_alter_table("tasks") as batch_op:
            batch_op.drop_column("function_id")

    existing_tables = _tables()
    if "functions" in existing_tables:
        op.drop_table("functions")
    if "pillars" in existing_tables:
        op.drop_table("pillars")
