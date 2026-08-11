"""Structured refusals for deletes that would leave dangling references behind.

SQLite is running without `PRAGMA foreign_keys` (see core.database), so nothing
at the storage layer stops a DELETE from orphaning child rows - the check has to
happen in the service layer, before the delete, or it does not happen at all.

The 409 body is structured rather than prose because the confirmation dialog
shows the blast radius before it asks. A caller that only wants a sentence reads
`message`; one that wants to build an interface reads `blockers`.
"""
from typing import List, NamedTuple

from fastapi import HTTPException

#: Discriminator on the 409 body, so a client can tell a blocked delete apart
#: from any other conflict without pattern-matching on prose.
DELETION_BLOCKED = "deletion_blocked"


class Blocker(NamedTuple):
    """One reason a delete was refused."""

    #: Stable identifier for the kind of reference, e.g. "tasks".
    kind: str
    count: int
    #: Human-readable breakdown, e.g. "3 completed, 4 pending". May be empty.
    detail: str = ""

    def phrase(self) -> str:
        return f"{self.count} {self.kind}" + (f" ({self.detail})" if self.detail else "")


def deletion_blocked(entity: str, name: str, blockers: List[Blocker], remedy: str) -> HTTPException:
    """The 409 to raise when something still points at the row being deleted.

    Returns the exception rather than raising it, so the call site reads as an
    ordinary `raise` and keeps its control flow visible.
    """
    summary = "; ".join(blocker.phrase() for blocker in blockers)
    return HTTPException(
        status_code=409,
        detail={
            "code": DELETION_BLOCKED,
            "entity": entity,
            "name": name,
            "message": f"{name} is still referenced by {summary}. {remedy}",
            "remedy": remedy,
            "blockers": [blocker._asdict() for blocker in blockers],
        },
    )
