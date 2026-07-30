from typing import List

from pydantic import BaseModel


class SheetInfo(BaseModel):
    key: str
    label: str
    group: str
    description: str
    range_scoped: bool
    #: Approximate row count for the current scope and window.
    row_estimate: int


class ExportManifest(BaseModel):
    #: Only the sheets this caller is allowed to request.
    sheets: List[SheetInfo]
    #: "all" when the caller may export every account, "own" when scoped.
    scope: str
    formats: List[str]
    default_sheets: List[str]
    group_order: List[str]
