"""Feature-access catalogue.

Permission keys are plain strings stored per user, so adding a gated feature
means adding an entry here - no migration.

Users whose role is "Admin" bypass every check (see require_permission), so an
administrator can never lock themselves out of the panel that grants access.
"""
from typing import Dict, List, NamedTuple


class Permission(NamedTuple):
    key: str
    label: str
    group: str
    description: str


PERMISSIONS: List[Permission] = [
    Permission("leaderboard.view", "View leaderboard", "Leaderboard",
               "See the point matrix and the point history chart."),
    Permission("tasks.view", "View tasks", "Tasks",
               "See the task board and task history."),
    Permission("tasks.complete", "Complete tasks", "Tasks",
               "Mark a task done and earn its points."),
    Permission("tasks.organize", "Reorder and move tasks", "Tasks",
               "Drag tasks within a category and between categories."),
    Permission("goals.view", "View goals", "Goals",
               "See goals, milestones and their progress."),
    Permission("admin.tasks", "Assign and manage tasks", "Administration",
               "Create and assign tasks, and edit or delete the ones on the board."),
    Permission("admin.goals", "Manage goals and milestones", "Administration",
               "Create, rename, and delete goals and milestones, and mark milestones complete."),
    Permission("admin.categories", "Manage categories", "Administration",
               "Create categories and change their default points."),
    Permission("admin.users", "Manage accounts and access", "Administration",
               "Add, deactivate and delete accounts, and grant or revoke feature access."),
    Permission("data.export", "Export data", "Data",
               "Download your own tasks, activity and points as CSV or Excel."),
    Permission("data.export.all", "Export everyone's data", "Data",
               "Widen exports to include every account's tasks, activity and points."),
]

PERMISSION_KEYS = {permission.key for permission in PERMISSIONS}

#: Granted to existing non-admin accounts by the migration. Chosen to match what
#: every logged-in user could already do before permissions existed, so turning
#: this system on takes nothing away from anyone.
LEGACY_MEMBER_PERMISSIONS = [
    "leaderboard.view",
    "tasks.view",
    "tasks.complete",
    "tasks.organize",
    "goals.view",
]

#: Applied to accounts created from the admin panel onwards.
DEFAULT_NEW_USER_PERMISSIONS = [
    "leaderboard.view",
    "tasks.view",
    "tasks.complete",
    "goals.view",
]


def grouped() -> Dict[str, List[Permission]]:
    """Catalogue keyed by group, preserving declaration order."""
    groups: Dict[str, List[Permission]] = {}
    for permission in PERMISSIONS:
        groups.setdefault(permission.group, []).append(permission)
    return groups


def unknown_keys(keys) -> List[str]:
    return sorted(set(keys) - PERMISSION_KEYS)
