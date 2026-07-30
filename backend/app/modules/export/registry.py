"""The sheet catalogue.

Adding a sheet means one entry here plus one builder - the manifest endpoint,
the UI checkbox list, both writers and the validation all read from this list,
so nothing else needs touching. Deliberately shaped like
auth.permissions.PERMISSIONS for the same reason.
"""
from typing import Callable, Dict, List, NamedTuple, Optional

from sqlalchemy import func

from app.modules.export import builders
from app.modules.goals.models import Goal, Milestone
from app.modules.tasks.models import Category, PointLedger, Task
from app.modules.users.models import User


class SheetSpec(NamedTuple):
    key: str
    label: str
    group: str
    description: str
    #: Whether the selected date window changes this sheet's contents.
    range_scoped: bool
    builder: Callable
    #: Extra permission required on top of `data.export`.
    permission: Optional[str] = None
    #: Tab name in the workbook / stem of the CSV file.
    filename: str = ""

    @property
    def sheet_name(self) -> str:
        return self.filename or self.key


SHEETS: List[SheetSpec] = [
    SheetSpec(
        "summary", "Summary", "Analytics",
        "Provenance and headline figures. Says what scope, window and timezone "
        "the rest of the file was built with.",
        True, builders.build_summary,
    ),
    SheetSpec(
        "users", "Users", "Core Data",
        "One row per account: points, task counts, activity span and granted "
        "permissions. Never includes credentials.",
        True, builders.build_users,
    ),
    SheetSpec(
        "categories", "Categories", "Core Data",
        "Per-category task counts, points awarded and share of total effort.",
        True, builders.build_categories,
    ),
    SheetSpec(
        "tasks", "Tasks", "Core Data",
        "Every task, denormalised - assignee, category, milestone and goal names "
        "alongside their ids, plus lifetime completion figures.",
        False, builders.build_tasks,
    ),
    SheetSpec(
        "activity_log", "Activity Log", "Core Data",
        "One row per point award, with the date pre-split into weekday, ISO week, "
        "month and year so Excel pivots need no formulas. The only sheet carrying "
        "timestamps.",
        True, builders.build_activity_log,
    ),
    SheetSpec(
        "goals", "Goals", "Core Data",
        "Goal progress, milestone counts and points earned against each goal.",
        False, builders.build_goals,
    ),
    SheetSpec(
        "milestones", "Milestones", "Core Data",
        "Milestone progress with its parent goal, task counts and assignees.",
        False, builders.build_milestones,
    ),
    SheetSpec(
        "leaderboard", "Leaderboard", "Analytics",
        "The point matrix as ranked on screen, with one column per category. "
        "Rank is always true rank, even in a scoped export.",
        True, builders.build_leaderboard,
    ),
    SheetSpec(
        "daily_activity", "Daily Activity", "Analytics",
        "Points per calendar day, one column per person, zero-filled. Defaults to "
        f"the last {builders.DEFAULT_SERIES_DAYS} days when no range is chosen.",
        True, builders.build_daily_activity,
    ),
    SheetSpec(
        "access_matrix", "Access Matrix", "Administration",
        "Who holds which permission. Admin rows read Yes everywhere because the "
        "role bypasses every check, not because those grants are stored.",
        False, builders.build_access_matrix, permission="admin.users",
    ),
]

SHEET_KEYS = [sheet.key for sheet in SHEETS]
BY_KEY: Dict[str, SheetSpec] = {sheet.key: sheet for sheet in SHEETS}

#: Pre-checked in the UI. The set that answers "just give me everything useful".
DEFAULT_SHEETS = ["summary", "users", "tasks", "activity_log", "leaderboard"]


def unknown_keys(keys) -> List[str]:
    return sorted(set(keys) - set(SHEET_KEYS))


def resolve(keys) -> List[SheetSpec]:
    """Requested keys as specs, in catalogue order rather than request order, so
    a workbook's tabs always come out in the same sequence."""
    requested = set(keys)
    return [sheet for sheet in SHEETS if sheet.key in requested]


def allowed(sheet: SheetSpec, permission_keys) -> bool:
    return sheet.permission is None or sheet.permission in permission_keys


def row_estimate(sheet: SheetSpec, ctx) -> int:
    """Cheap COUNT for the checkbox labels - never builds the sheet.

    Approximate by design: it counts the underlying rows, so sheets whose length
    is derived (Summary, Daily Activity) report their own shape instead.
    """
    db = ctx.db
    if sheet.key == "summary":
        return 0
    if sheet.key == "users":
        return ctx.limit_users(db.query(func.count(User.id)), User.id).scalar() or 0
    if sheet.key == "categories":
        return db.query(func.count(Category.id)).scalar() or 0
    if sheet.key == "tasks":
        return ctx.limit_users(db.query(func.count(Task.id)), Task.user_id).scalar() or 0
    if sheet.key == "activity_log":
        query = ctx.limit_users(db.query(func.count(PointLedger.id)), PointLedger.user_id)
        return ctx.in_range(query, PointLedger.timestamp).scalar() or 0
    if sheet.key == "goals":
        return db.query(func.count(Goal.id)).scalar() or 0
    if sheet.key == "milestones":
        return db.query(func.count(Milestone.id)).scalar() or 0
    if sheet.key in ("leaderboard", "access_matrix"):
        return ctx.limit_users(db.query(func.count(User.id)), User.id).scalar() or 0
    if sheet.key == "daily_activity":
        start, end = builders._series_window(ctx)
        return (end - start).days + 1
    return 0
