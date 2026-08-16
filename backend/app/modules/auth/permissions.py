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
    Permission("capture.write", "Capture to own inbox", "Capture",
               "Add open loops to your own inbox, and discard them again. Private to you. "
               "Also allows clarifying an item into your own lists; sending one to the "
               "task board still needs admin.tasks."),
    Permission("lists.write", "Own Someday, Reference and Waiting lists", "Capture",
               "Keep your own someday/maybe, reference and waiting-on lists. Private to you."),
    Permission("boards.write", "Own MyUniverse board", "Capture",
               "Open your own GTD board, and drag cards around it. Private to you."),
    Permission("boards.team", "Create shared boards", "Capture",
               "Create boards other people can see, and choose who is on them. Unlike the "
               "keys above this one makes work visible to colleagues, so it is granted "
               "deliberately rather than by default."),
    Permission("calendar.sync", "Sync own Google Calendar", "Capture",
               "Connect your own Google account and keep your board's dated cards and "
               "your calendar in step. Private to you: the connection is authorised in "
               "your own browser, reads only the calendar you pick, and no other account "
               "can reach it."),
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
    Permission("panel.view", "View own panel", "Panel",
               "See your own pillar mix, your seat, and where your week actually went."),
    Permission("panel.view.all", "View anyone's panel", "Panel",
               "Open another account's panel, not just your own."),
    Permission("admin.tasks", "Assign and manage tasks", "Administration",
               "Create and assign tasks, and edit or delete the ones on the board."),
    Permission("admin.goals", "Manage goals and milestones", "Administration",
               "Create, rename, and delete goals and milestones, and mark milestones complete."),
    Permission("admin.categories", "Manage categories", "Administration",
               "Create categories and change their default points."),
    Permission("admin.users", "Manage accounts and access", "Administration",
               "Add, deactivate and delete accounts, and grant or revoke feature access."),
    Permission("admin.taxonomy", "Manage pillars and seats", "Administration",
               "Edit the pillars and functions work is tagged with, and set who sits where."),
    Permission("admin.mail", "Manage mail", "Administration",
               "See the SMTP settings the server is using and send a test message."),
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
#:
#: `panel.view` is here rather than being something to grant later because the
#: panel is where a person lands: an account that cannot open it has no home
#: screen. Existing accounts were given the same key by migration a1c4e07f52bd.
#:
#: `capture.write` is here for a stronger reason than convenience. It only ever
#: opens your own inbox - it grants no sight of anyone else's work and creates
#: nothing anybody else can see - so there is no case where withholding it
#: protects anything. What it would do is leave an account unable to write down
#: what is on its mind, which is the one thing this whole system is for.
#: Existing accounts were given it by migration d4a2b6f18e93, and `lists.write`
#: - which opens the private lists an inbox item gets clarified into, on exactly
#: the same reasoning - by e7b3c9d05a41.
#:
#: `boards.write` joins them for the same reason once more: it opens one board,
#: the account's own, which nobody else can read. `boards.team` is *not* here -
#: a shared board is visible to colleagues, so it stays a deliberate grant.
#:
#: `calendar.sync` is here on the same reasoning again, and note what it is not:
#: it is not access to a calendar. Holding the key lets an account *offer* its
#: own Google account a consent screen; only Google, in that person's browser,
#: can grant anything. Existing accounts were given it by migration
#: b6d2e9f14c80.
DEFAULT_NEW_USER_PERMISSIONS = [
    "capture.write",
    "lists.write",
    "boards.write",
    "calendar.sync",
    "leaderboard.view",
    "tasks.view",
    "tasks.complete",
    "goals.view",
    "panel.view",
]


def grouped() -> Dict[str, List[Permission]]:
    """Catalogue keyed by group, preserving declaration order."""
    groups: Dict[str, List[Permission]] = {}
    for permission in PERMISSIONS:
        groups.setdefault(permission.group, []).append(permission)
    return groups


def unknown_keys(keys) -> List[str]:
    return sorted(set(keys) - PERMISSION_KEYS)
