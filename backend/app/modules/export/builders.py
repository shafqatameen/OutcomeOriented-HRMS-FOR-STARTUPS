"""One builder per sheet.

Each takes an ExportContext and returns `(headers, rows)`. Rows are plain lists
of scalars in header order - no ORM objects ever reach a writer, which is what
keeps `users.password_hash` out of every output by construction rather than by
remembering to exclude it.

Naming convention: a column suffixed `_in_range` honours the selected date
window; everything else is a lifetime figure. Task/goal/milestone completion
counts are deliberately lifetime, because tasks carry no creation date - scoping
them would show `status=Completed` alongside `times_completed=0` whenever the
completion fell outside the window, which reads as a bug.
"""
from datetime import timedelta
from typing import List, Tuple

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.modules.auth.dependencies import granted_keys
from app.modules.auth.permissions import PERMISSIONS
from app.modules.goals.models import Goal, Milestone
from app.modules.goals.router import _serialize_goal, _serialize_milestone
from app.modules.leaderboard.service import compute_daily_series, compute_leaderboard
from app.modules.tasks.models import Category, PointLedger, Task, get_ist_now
from app.modules.tasks.points import effective_points
from app.modules.users.models import User

#: Window used by the daily series when the export asks for all time. Unbounded
#: would mean one column per day since the first entry ever.
DEFAULT_SERIES_DAYS = 30

Sheet = Tuple[List[str], List[list]]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _fmt_dt(value) -> str:
    """SQLite returns aggregates over DateTime as strings, real columns as
    datetimes. Normalise both to a locale-proof, sortable string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.split(".")[0]
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _pct(part, whole) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def _ratio(part, whole) -> float:
    return round(part / whole, 2) if whole else 0.0


def _yes_no(value) -> str:
    return "Yes" if value else "No"


def _visible_users(ctx) -> List[User]:
    query = ctx.limit_users(ctx.db.query(User), User.id)
    return query.order_by(User.name).all()


def _ledger(ctx):
    """Ledger query, scoped to visible users and the date window."""
    query = ctx.db.query(PointLedger)
    query = ctx.limit_users(query, PointLedger.user_id)
    return ctx.in_range(query, PointLedger.timestamp)


def _ledger_agg(ctx, *columns, ranged: bool = True):
    """Grouped-aggregate query over the ledger, joined to Task for category and
    milestone filters. Task join is an outer join because task_id is nullable."""
    query = ctx.db.query(*columns).outerjoin(Task, Task.id == PointLedger.task_id)
    query = ctx.limit_users(query, PointLedger.user_id)
    if ranged:
        query = ctx.in_range(query, PointLedger.timestamp)
    return _apply_task_filters(ctx, query)


def _apply_task_filters(ctx, query):
    """The optional narrowing filters, all of which live on Task."""
    if ctx.category_id is not None:
        query = query.filter(Task.category_id == ctx.category_id)
    if ctx.status is not None:
        query = query.filter(Task.status == ctx.status)
    if ctx.goal_id is not None:
        milestone_ids = [
            row[0] for row in ctx.db.query(Milestone.id).filter(Milestone.goal_id == ctx.goal_id)
        ]
        query = query.filter(Task.milestone_id.in_(milestone_ids or [-1]))
    return query


def _task_query(ctx):
    """Tasks visible to this export, with every optional filter applied."""
    query = ctx.db.query(Task)
    query = ctx.limit_users(query, Task.user_id)
    return _apply_task_filters(ctx, query)


def _series_window(ctx):
    """Inclusive start/end start-of-day values for the daily series."""
    now = get_ist_now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = ctx.range_end - timedelta(days=1) if ctx.range_end else today
    start = ctx.range_start if ctx.range_start else end - timedelta(days=DEFAULT_SERIES_DAYS - 1)
    return start, end


# --------------------------------------------------------------------------- #
# Core Data
# --------------------------------------------------------------------------- #

def build_users(ctx) -> Sheet:
    headers = [
        "user_id", "name", "role", "all_time_points", "points_in_range",
        "tasks_assigned", "tasks_completed", "tasks_pending", "completion_rate_pct",
        "recurring_tasks_assigned", "completions_in_range", "active_days_in_range",
        "avg_points_per_active_day", "first_activity_at", "last_activity_at",
        "permission_count", "permissions",
    ]

    users = _visible_users(ctx)

    points_in_range = dict(
        _ledger_agg(
            ctx, PointLedger.user_id, func.sum(PointLedger.points_awarded)
        ).group_by(PointLedger.user_id).all()
    )
    completions_in_range = dict(
        _ledger_agg(
            ctx, PointLedger.user_id, func.count(PointLedger.id)
        ).group_by(PointLedger.user_id).all()
    )
    active_days = dict(
        _ledger_agg(
            ctx, PointLedger.user_id, func.count(func.distinct(func.date(PointLedger.timestamp)))
        ).group_by(PointLedger.user_id).all()
    )
    # Lifetime span, deliberately not windowed.
    activity_span = {
        user_id: (first, last)
        for user_id, first, last in _ledger_agg(
            ctx,
            PointLedger.user_id,
            func.min(PointLedger.timestamp),
            func.max(PointLedger.timestamp),
            ranged=False,
        ).group_by(PointLedger.user_id).all()
    }

    task_stats = {}
    for user_id, status, is_recurring, count in (
        _task_query(ctx)
        .with_entities(Task.user_id, Task.status, Task.is_recurring, func.count(Task.id))
        .group_by(Task.user_id, Task.status, Task.is_recurring)
        .all()
    ):
        stats = task_stats.setdefault(user_id, {"total": 0, "completed": 0, "recurring": 0})
        stats["total"] += count
        if status == "Completed":
            stats["completed"] += count
        if is_recurring:
            stats["recurring"] += count

    rows = []
    for user in users:
        stats = task_stats.get(user.id, {"total": 0, "completed": 0, "recurring": 0})
        pending = stats["total"] - stats["completed"]
        earned = points_in_range.get(user.id) or 0
        days = active_days.get(user.id) or 0
        first, last = activity_span.get(user.id, (None, None))
        keys = granted_keys(ctx.db, user)
        rows.append([
            user.id, user.name, user.role, user.total_points or 0, earned,
            stats["total"], stats["completed"], pending,
            _pct(stats["completed"], stats["total"]),
            stats["recurring"], completions_in_range.get(user.id) or 0, days,
            _ratio(earned, days), _fmt_dt(first), _fmt_dt(last),
            len(keys), "; ".join(keys),
        ])
    return headers, rows


def build_categories(ctx) -> Sheet:
    headers = [
        "category_id", "name", "default_points", "tasks_total", "tasks_completed",
        "tasks_pending", "points_awarded_in_range", "share_of_points_pct",
        "distinct_contributors_in_range", "completions_in_range", "avg_points_per_completion",
    ]

    categories = ctx.db.query(Category).order_by(Category.name).all()
    if ctx.category_id is not None:
        categories = [c for c in categories if c.id == ctx.category_id]

    task_stats = {}
    for category_id, status, count in (
        _task_query(ctx)
        .with_entities(Task.category_id, Task.status, func.count(Task.id))
        .group_by(Task.category_id, Task.status)
        .all()
    ):
        stats = task_stats.setdefault(category_id, {"total": 0, "completed": 0})
        stats["total"] += count
        if status == "Completed":
            stats["completed"] += count

    ledger_stats = {
        category_id: (total or 0, entries or 0, contributors or 0)
        for category_id, total, entries, contributors in _ledger_agg(
            ctx,
            Task.category_id,
            func.sum(PointLedger.points_awarded),
            func.count(PointLedger.id),
            func.count(func.distinct(PointLedger.user_id)),
        ).group_by(Task.category_id).all()
    }
    grand_total = sum(total for total, _, _ in ledger_stats.values())

    rows = []
    for category in categories:
        stats = task_stats.get(category.id, {"total": 0, "completed": 0})
        total, entries, contributors = ledger_stats.get(category.id, (0, 0, 0))
        rows.append([
            category.id, category.name, category.default_points,
            stats["total"], stats["completed"], stats["total"] - stats["completed"],
            total, _pct(total, grand_total), contributors, entries,
            _ratio(total, entries),
        ])
    return headers, rows


def build_tasks(ctx) -> Sheet:
    headers = [
        "task_id", "title", "status", "assignee_id", "assignee_name",
        "category_id", "category_name", "category_default_points",
        "points_override", "effective_points", "is_recurring",
        "milestone_id", "milestone_title", "goal_id", "goal_title",
        "board_position", "times_completed", "points_earned_total",
        "first_completed_at", "last_completed_at",
    ]

    tasks = (
        _task_query(ctx)
        .options(
            joinedload(Task.user),
            joinedload(Task.category),
            joinedload(Task.milestone).joinedload(Milestone.goal),
        )
        .order_by(Task.position, Task.id)
        .all()
    )

    # Lifetime per-task ledger figures - see the module docstring.
    ledger_stats = {
        task_id: (count, total or 0, first, last)
        for task_id, count, total, first, last in (
            ctx.db.query(
                PointLedger.task_id,
                func.count(PointLedger.id),
                func.sum(PointLedger.points_awarded),
                func.min(PointLedger.timestamp),
                func.max(PointLedger.timestamp),
            )
            .filter(PointLedger.task_id.isnot(None))
            .group_by(PointLedger.task_id)
            .all()
        )
    }

    rows = []
    for task in tasks:
        category = task.category
        milestone = task.milestone
        goal = milestone.goal if milestone else None
        count, total, first, last = ledger_stats.get(task.id, (0, 0, None, None))
        rows.append([
            task.id, task.title, task.status, task.user_id,
            task.user.name if task.user else "",
            task.category_id, category.name if category else "",
            category.default_points if category else "",
            task.points if task.points is not None else "",
            effective_points(task), _yes_no(task.is_recurring),
            task.milestone_id, milestone.title if milestone else "",
            goal.id if goal else "", goal.title if goal else "",
            task.position, count, total, _fmt_dt(first), _fmt_dt(last),
        ])
    return headers, rows


def build_activity_log(ctx) -> Sheet:
    headers = [
        "entry_id", "timestamp_ist", "date", "time", "day_of_week", "iso_week",
        "month", "year", "user_id", "user_name", "task_id", "task_title",
        "category_id", "category_name", "milestone_title", "goal_title",
        "points_awarded", "is_recurring_task",
    ]

    query = (
        ctx.db.query(
            PointLedger.id,
            PointLedger.timestamp,
            PointLedger.points_awarded,
            PointLedger.user_id,
            User.name.label("user_name"),
            Task.id.label("task_id"),
            Task.title.label("task_title"),
            Task.is_recurring,
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            Milestone.title.label("milestone_title"),
            Goal.title.label("goal_title"),
        )
        # All outer joins: task_id, category_id and milestone_id are all nullable.
        .outerjoin(User, User.id == PointLedger.user_id)
        .outerjoin(Task, Task.id == PointLedger.task_id)
        .outerjoin(Category, Category.id == Task.category_id)
        .outerjoin(Milestone, Milestone.id == Task.milestone_id)
        .outerjoin(Goal, Goal.id == Milestone.goal_id)
    )
    query = ctx.limit_users(query, PointLedger.user_id)
    query = ctx.in_range(query, PointLedger.timestamp)
    query = _apply_task_filters(ctx, query)

    rows = []
    for row in query.order_by(PointLedger.timestamp, PointLedger.id).all():
        stamp = row.timestamp
        if isinstance(stamp, str):
            date_part, _, time_part = stamp.partition(" ")
            rows.append([
                row.id, _fmt_dt(stamp), date_part, time_part.split(".")[0],
                "", "", "", "", row.user_id, row.user_name or "",
                row.task_id or "", row.task_title or "",
                row.category_id or "", row.category_name or "",
                row.milestone_title or "", row.goal_title or "",
                row.points_awarded, _yes_no(row.is_recurring),
            ])
            continue
        rows.append([
            row.id, _fmt_dt(stamp),
            stamp.strftime("%Y-%m-%d"), stamp.strftime("%H:%M:%S"),
            stamp.strftime("%A"), stamp.isocalendar()[1],
            stamp.strftime("%Y-%m"), stamp.year,
            row.user_id, row.user_name or "",
            row.task_id or "", row.task_title or "",
            row.category_id or "", row.category_name or "",
            row.milestone_title or "", row.goal_title or "",
            row.points_awarded, _yes_no(row.is_recurring),
        ])
    return headers, rows


def _points_by_milestone(ctx):
    """Points earned per milestone, scoped to visible users. Lifetime."""
    return {
        milestone_id: (total or 0, contributors or 0)
        for milestone_id, total, contributors in (
            ctx.limit_users(
                ctx.db.query(
                    Task.milestone_id,
                    func.sum(PointLedger.points_awarded),
                    func.count(func.distinct(PointLedger.user_id)),
                ).join(Task, Task.id == PointLedger.task_id),
                PointLedger.user_id,
            )
            .filter(Task.milestone_id.isnot(None))
            .group_by(Task.milestone_id)
            .all()
        )
    }


def build_goals(ctx) -> Sheet:
    headers = [
        "goal_id", "title", "milestone_count", "completed_milestone_count",
        "progress_pct", "tasks_total", "tasks_completed", "points_earned",
        "contributor_count",
    ]

    query = ctx.db.query(Goal)
    if ctx.goal_id is not None:
        query = query.filter(Goal.id == ctx.goal_id)
    goals = query.order_by(Goal.id).all()

    milestone_points = _points_by_milestone(ctx)

    rows = []
    for goal in goals:
        # Structural progress comes from the same function the /goals page uses,
        # so the sheet can never disagree with the screen. It is org-wide, like
        # the page itself; only the point columns below are user-scoped.
        data = _serialize_goal(goal)
        tasks_total = sum(m["task_count"] for m in data["milestones"])
        tasks_completed = sum(m["completed_task_count"] for m in data["milestones"])
        points = sum(milestone_points.get(m["id"], (0, 0))[0] for m in data["milestones"])
        contributors = {
            task.user_id
            for milestone in goal.milestones
            for task in milestone.tasks
            if task.user_id is not None and ctx.user_is_visible(task.user_id)
        }
        rows.append([
            data["id"], data["title"], data["milestone_count"],
            data["completed_milestone_count"], data["progress_pct"],
            tasks_total, tasks_completed, points, len(contributors),
        ])
    return headers, rows


def build_milestones(ctx) -> Sheet:
    headers = [
        "milestone_id", "title", "goal_id", "goal_title", "status",
        "task_count", "completed_task_count", "progress_pct", "points_earned",
        "assignees",
    ]

    query = ctx.db.query(Milestone)
    if ctx.goal_id is not None:
        query = query.filter(Milestone.goal_id == ctx.goal_id)
    milestones = query.order_by(Milestone.goal_id, Milestone.id).all()

    milestone_points = _points_by_milestone(ctx)

    rows = []
    for milestone in milestones:
        data = _serialize_milestone(milestone)
        points, _ = milestone_points.get(milestone.id, (0, 0))
        assignees = sorted({
            task.user.name
            for task in milestone.tasks
            if task.user and ctx.user_is_visible(task.user_id)
        })
        rows.append([
            data["id"], data["title"], data["goal_id"],
            milestone.goal.title if milestone.goal else "",
            data["status"], data["task_count"], data["completed_task_count"],
            data["progress_pct"], points, "; ".join(assignees),
        ])
    return headers, rows


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #

def build_leaderboard(ctx) -> Sheet:
    categories = ctx.db.query(Category).order_by(Category.id).all()
    headers = [
        "rank", "user_id", "name", "points_in_range", "all_time_points",
        "points_today", "points_this_week",
    ] + [f"points_{(category.name or '').strip()}" for category in categories]

    entries = compute_leaderboard(
        ctx.db, ctx.range_start, ctx.range_end, ctx.visible_user_ids
    )
    if ctx.user_id is not None:
        entries = [entry for entry in entries if entry["user_id"] == ctx.user_id]

    rows = [
        [
            entry["rank"], entry["user_id"], entry["name"], entry["total_points"],
            entry["all_time_points"], entry["daily_points"], entry["weekly_points"],
        ] + [entry["category_points"].get(str(category.id), 0) for category in categories]
        for entry in entries
    ]
    return headers, rows


def build_daily_activity(ctx) -> Sheet:
    users = _visible_users(ctx)
    headers = ["date"] + [user.name for user in users] + ["total"]

    start, end = _series_window(ctx)
    # _visible_users has already applied scoping and the user_id filter, so its
    # ids are exactly the columns this sheet should carry.
    series = compute_daily_series(
        ctx.db, start, end, ctx.category_id, {user.id for user in users}
    )

    rows = []
    for point in series:
        values = [point.get(user.name, 0) for user in users]
        rows.append([point["date"]] + values + [sum(values)])
    return headers, rows


def build_access_matrix(ctx) -> Sheet:
    """Raw permission keys as headers - a CSV consumer wants the stable
    identifier, not prose. Admin rows read Yes everywhere because the role is a
    superuser bypass, not because those grants are stored."""
    headers = ["user_id", "name", "role"] + [p.key for p in PERMISSIONS] + ["granted_count"]

    rows = []
    for user in _visible_users(ctx):
        keys = set(granted_keys(ctx.db, user))
        rows.append(
            [user.id, user.name, user.role]
            + [_yes_no(p.key in keys) for p in PERMISSIONS]
            + [len(keys)]
        )
    return headers, rows


def build_summary(ctx) -> Sheet:
    """Provenance plus headline figures.

    An exported file gets forwarded and opened months later with no memory of
    what was asked for, so it has to describe its own scope, window and
    timezone.
    """
    headers = ["Field", "Value"]
    db = ctx.db

    users = _visible_users(ctx)
    tasks = _task_query(ctx).all()
    completed = [t for t in tasks if t.status == "Completed"]
    recurring = [t for t in tasks if t.is_recurring]

    range_points = (
        _ledger_agg(ctx, func.sum(PointLedger.points_awarded)).scalar() or 0
    )
    range_entries = _ledger_agg(ctx, func.count(PointLedger.id)).scalar() or 0
    all_time_points = sum(user.total_points or 0 for user in users)

    goals = [_serialize_goal(g) for g in db.query(Goal).all()]
    milestones = [_serialize_milestone(m) for m in db.query(Milestone).all()]
    goal_avg = _ratio(sum(g["progress_pct"] for g in goals), len(goals))
    milestone_avg = _ratio(sum(m["progress_pct"] for m in milestones), len(milestones))

    sheet_labels = ", ".join(ctx.sheet_keys or [])
    scope_note = (
        "All accounts" if ctx.sees_all_users()
        else f"Own data only ({ctx.actor.name})"
    )

    rows = [
        ["Generated at (IST)", _fmt_dt(get_ist_now())],
        ["Generated by", ctx.actor.name],
        ["Scope", scope_note],
        ["Date range", ctx.range_label()],
        ["Sheets included", sheet_labels],
        ["Timezone", "Asia/Kolkata (IST). Stored timestamps carry no offset."],
        [],
        ["Accounts", len(users)],
        ["Admins", sum(1 for u in users if u.role == "Admin")],
        ["Members", sum(1 for u in users if u.role != "Admin")],
        [],
        ["Tasks total", len(tasks)],
        ["Tasks completed", len(completed)],
        ["Tasks pending", len(tasks) - len(completed)],
        ["Tasks recurring", len(recurring)],
        ["Tasks one-off", len(tasks) - len(recurring)],
        ["Task completion rate %", _pct(len(completed), len(tasks))],
        [],
        ["Points awarded in range", range_points],
        ["Points all time", all_time_points],
        ["Ledger entries in range", range_entries],
        ["Avg points per completion", _ratio(range_points, range_entries)],
        [],
        ["Categories", db.query(func.count(Category.id)).scalar() or 0],
        ["Goals", len(goals)],
        ["Goals at 100%", sum(1 for g in goals if g["progress_pct"] == 100.0)],
        ["Avg goal progress %", goal_avg],
        ["Milestones", len(milestones)],
        ["Milestones completed", sum(1 for m in milestones if m["status"] == "Completed")],
        ["Avg milestone progress %", milestone_avg],
    ]
    return headers, rows
