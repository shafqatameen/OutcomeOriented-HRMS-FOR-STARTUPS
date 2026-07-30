"""Everything a sheet builder needs to know about one export request."""
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Set

from sqlalchemy.orm import Session


@dataclass
class ExportContext:
    """One export request, resolved.

    `visible_user_ids` is the single scoping lever: None means every account,
    a set means only these. Builders MUST honour it - both for the rows they
    emit and for any aggregate they compute - so a member without
    `data.export.all` cannot infer anything about other accounts.
    """

    db: Session
    actor: object
    #: Half-open window (see core.daterange). Both None means all time.
    range_start: Optional[datetime] = None
    range_end: Optional[datetime] = None
    visible_user_ids: Optional[Set[int]] = None
    #: Optional narrowing, applied to the task and activity sheets.
    category_id: Optional[int] = None
    goal_id: Optional[int] = None
    status: Optional[str] = None
    user_id: Optional[int] = None
    #: Keys of the sheets in this request, for the Summary sheet's provenance.
    sheet_keys: Optional[List[str]] = None

    @property
    def scope(self) -> str:
        return "own" if self.visible_user_ids is not None else "all"

    def sees_all_users(self) -> bool:
        return self.visible_user_ids is None

    def limit_users(self, query, column):
        """Applies user scoping to a query, plus the optional user_id filter."""
        if self.visible_user_ids is not None:
            query = query.filter(column.in_(self.visible_user_ids))
        if self.user_id is not None:
            query = query.filter(column == self.user_id)
        return query

    def in_range(self, query, column):
        """Applies the date window to a query on a timestamp column."""
        if self.range_start is not None:
            query = query.filter(column >= self.range_start)
        if self.range_end is not None:
            query = query.filter(column < self.range_end)
        return query

    def user_is_visible(self, user_id) -> bool:
        """For in-Python filtering where a query filter is impractical."""
        if self.user_id is not None and user_id != self.user_id:
            return False
        if self.visible_user_ids is None:
            return True
        return user_id in self.visible_user_ids

    def range_label(self) -> str:
        if self.range_start is None and self.range_end is None:
            return "All time"
        start = self.range_start.strftime("%Y-%m-%d") if self.range_start else "beginning"
        # range_end is exclusive; report the inclusive day the user asked for.
        if self.range_end is not None:
            from datetime import timedelta

            end = (self.range_end - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            end = "today"
        return f"{start} to {end}"
