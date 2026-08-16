from typing import List, Optional

from pydantic import BaseModel


class Measured(BaseModel):
    """Both currencies plus the share, because they answer different questions.

    Points are what the track axis prices the work at; minutes are how long it
    actually took. `share` is computed on whichever unit the panel is reporting
    in - see panel.service for why that is chosen per request.
    """
    points: int
    minutes: int
    share: float


class TrackRow(Measured):
    track_id: int
    name: str
    default_points: int


class PillarRow(Measured):
    pillar_id: int
    name: str
    slug: str
    color_hex: str
    is_company: bool


class FunctionRow(Measured):
    function_id: int
    name: str
    purpose: Optional[str] = None
    color_hex: str
    pillar_id: int
    pillar_name: str
    pillar_slug: str
    open_tasks: int
    completed_tasks: int


class MatrixCell(Measured):
    """One Track x Pillar intersection. Sparse - empty cells are omitted."""
    track_id: int
    pillar_id: int


class Seat(BaseModel):
    function_id: int
    function_name: str
    purpose: Optional[str] = None
    color_hex: str
    pillar_id: Optional[int] = None
    pillar_name: Optional[str] = None
    pillar_slug: Optional[str] = None


class PanelUser(BaseModel):
    id: int
    name: str
    role: str


class Totals(BaseModel):
    points: int
    minutes: int
    open_tasks: int
    completed_tasks: int
    #: Ledger entries in this window, and how many carry a duration. The panel
    #: only measures in time once those two are equal - see panel.service.
    entries: int
    entries_with_minutes: int


class Headline(BaseModel):
    core_share: float
    #: How the Product/Customer effort splits. Meaningless when neither has any,
    #: which is what `has_build_sell` is for - a 0/0 split must not render as 0%.
    product_share_of_build_sell: float
    customer_share_of_build_sell: float
    has_build_sell: bool
    #: None when this account has no seat, which is different from 0%.
    on_seat_share: Optional[float] = None


class OpenTask(BaseModel):
    task_id: int
    title: str
    track_name: str
    function_name: str
    pillar_name: str
    pillar_slug: str
    color_hex: str
    points: int


class Panel(BaseModel):
    user: PanelUser
    seat: Optional[Seat] = None
    #: "minutes" only when every entry in the window is timed, else "points".
    unit: str
    totals: Totals
    headline: Headline
    tracks: List[TrackRow]
    pillars: List[PillarRow]
    functions: List[FunctionRow]
    matrix: List[MatrixCell]
    open_work: List[OpenTask]


class SeatUpdate(BaseModel):
    """Null clears the seat. Omission is not allowed - this endpoint does one thing."""
    home_function_id: Optional[int] = None


# --- company rollup -------------------------------------------------------
# Same axes as one person's panel, on the whole ledger, plus the people axis
# that only exists in aggregate.


class CompanyFunctionRow(FunctionRow):
    #: Distinct accounts that logged anything here. A function at 30% carried by
    #: one person is a different fact from one carried by four, and the pillar
    #: mix alone cannot tell them apart.
    contributors: int


class PersonRow(Measured):
    """One account's slice of the company window. `share` is of the company."""
    user_id: int
    name: str
    role: str
    seat_function_id: Optional[int] = None
    seat_function_name: Optional[str] = None
    seat_pillar_name: Optional[str] = None
    seat_pillar_slug: Optional[str] = None
    open_tasks: int
    #: How much of *their own* effort landed on their seat - not of the company's,
    #: so it survives someone else having a big week. None when they have no seat.
    on_seat_share: Optional[float] = None


class PersonPillarCell(Measured):
    """One person's effort in one pillar.

    `share` is a share **of that person**, not of the company: the question is
    "what is this person working on", and a company-relative bar would just
    redraw the headcount.
    """
    user_id: int
    pillar_id: int


class CompanyTotals(Totals):
    #: Accounts that logged anything in this window, and how many have a seat.
    people: int
    seated_people: int


class CompanyHeadline(Headline):
    #: The fraction that carries no function tag. Part of the headline rather
    #: than a footnote: a focus chart built from mostly-untagged work is
    #: describing the tagging, not the focus.
    untagged_share: float
    #: Where the company actually concentrated. None on an empty window.
    top_pillar_name: Optional[str] = None
    top_pillar_slug: Optional[str] = None
    top_pillar_share: Optional[float] = None
    top_function_name: Optional[str] = None
    top_function_pillar_slug: Optional[str] = None
    top_function_share: Optional[float] = None


class CompanyPanel(BaseModel):
    unit: str
    totals: CompanyTotals
    headline: CompanyHeadline
    tracks: List[TrackRow]
    pillars: List[PillarRow]
    functions: List[CompanyFunctionRow]
    matrix: List[MatrixCell]
    people: List[PersonRow]
    people_mix: List[PersonPillarCell]
