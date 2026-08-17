"""The one place the points precedence rule lives.

An explicit value on the task wins; otherwise the task inherits its category's
default. Because nothing is copied into the task on assignment, editing a
category's default retroactively changes what its uncompleted tasks are worth -
and moving a task between categories changes its value too, unless a custom
value was pinned in Admin.
"""


def effective_points(task, category=None) -> int:
    """Points this task is worth right now.

    `category` is an optional override for callers that already hold the row (or
    are moving the task into a different one), avoiding a lazy load.
    """
    if task.points is not None:
        return task.points
    category = category if category is not None else task.category
    if category is None:
        return 0
    return category.default_points or 0


def points_are_pinned(task) -> bool:
    """Whether this task carries its own value instead of inheriting one."""
    return task.points is not None
