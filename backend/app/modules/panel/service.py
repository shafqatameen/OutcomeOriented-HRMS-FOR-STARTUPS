"""Effort rollup across both axes - for one person, and for the whole company.

Kept out of the router for the same reason leaderboard.service is: a number on
the panel and the same number in an export have to come from one function, or
they will eventually disagree. The company rollup shares that reasoning twice
over - "58% Product" on the company page and the sum of what each person's own
panel says have to be the same claim, so both are computed here from the same
ledger rows and shaped by the same helpers.

Two things make this more than a GROUP BY:

1. **Points and minutes measure different things, and both are needed.** Points
   are the incentive - Core is worth 3, Adjacent 2, Drain 0. Minutes are the
   diagnosis. A points-only mix reports the Drain track as 0% no matter how many
   hours went into it, which is exactly backwards for the one view meant to
   expose those hours. So every bucket carries both.

   `share` switches to minutes only when *every* ledger row in the window has
   them. Anything less is worse than useless: a row with no minutes counts as
   zero, so the first task anyone times would drag every untimed one to 0% and
   the mix would read as confidently wrong rather than visibly incomplete. Until
   coverage is total the panel reports points and says how many entries are
   missing a duration, which is a gap the reader can see and close.

   Company-wide this bar is harder to clear than it is for one person - one
   untimed entry from anyone puts the whole company back onto points - and that
   is the honest behaviour. A company time mix assembled from the two people who
   happen to log durations is not a company time mix.

2. **Untagged work has to stay visible.** `PointLedger.task_id`, `Task.function_id`
   and `Task.category_id` are all nullable, and on the day this ships every task
   in the database is untagged on the domain axis. Points that fall through are
   collected into an explicit Unassigned bucket rather than dropped, because a
   mix that quietly fails to add up to the leaderboard total is worse than one
   that says "40% of this is untagged". The company headline goes further and
   states that fraction outright: a focus chart drawn from mostly-untagged work
   is describing the tagging, not the focus.
"""
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.org.models import Function, Pillar
from app.modules.tasks.models import Category, PointLedger, Task
from app.modules.users.models import User

#: Stand-in identity for work that carries no tag on an axis. Negative so it can
#: never collide with a real row id, and stable so the UI can style it.
UNASSIGNED_ID = -1
UNASSIGNED_PILLAR = {
    "id": UNASSIGNED_ID,
    "name": "Unassigned",
    "slug": "unassigned",
    "color_hex": "#9a9a90",
    "is_company": False,
}
UNASSIGNED_FUNCTION_NAME = "Untagged"
UNASSIGNED_TRACK_NAME = "Untracked"


def _share(part: int, whole: int) -> float:
    """Percentage of `whole`, to one decimal. Zero whole means zero share."""
    if not whole:
        return 0.0
    return round(part * 100.0 / whole, 1)


def _add(bucket: dict, key, points: int, minutes: int) -> None:
    """Accumulates one ledger row into one bucket, creating it on first sight."""
    entry = bucket.setdefault(key, {"points": 0, "minutes": 0})
    entry["points"] += points
    entry["minutes"] += minutes


def _resolve_unit(entries: int, entries_with_minutes: int,
                  total_points: int, total_minutes: int) -> Tuple[str, int]:
    """Which currency this window is reported in, and its denominator.

    Minutes are the better denominator, but only once they are on everything: a
    partially timed window would score every untimed entry as zero effort.
    """
    fully_timed = entries > 0 and entries_with_minutes == entries
    if fully_timed:
        return "minutes", total_minutes
    return "points", total_points


def _measured(entry: Optional[dict], unit: str, whole: int) -> dict:
    """One bucket as both currencies plus its share of `whole`."""
    entry = entry or {"points": 0, "minutes": 0}
    return {
        "points": entry["points"],
        "minutes": entry["minutes"],
        "share": _share(entry[unit], whole),
    }


def _taxonomy(db: Session):
    """Both axes in display order, with the lookups every shaping step needs."""
    pillars = db.query(Pillar).order_by(Pillar.position, Pillar.id).all()
    functions = db.query(Function).order_by(Function.position, Function.id).all()
    categories = db.query(Category).order_by(Category.id).all()
    return (
        pillars,
        functions,
        categories,
        {f.id: f.pillar_id for f in functions},
        {f.id: f for f in functions},
        {p.id: p for p in pillars},
        {c.id: c for c in categories},
    )


def _pillar_rows(pillars, by_pillar: dict, unit: str, whole: int) -> List[dict]:
    """Pillars that carry effort, biggest first. Empty pillars are omitted."""
    rows = [
        {
            "pillar_id": pillar.id,
            "name": pillar.name,
            "slug": pillar.slug,
            "color_hex": pillar.color_hex,
            "is_company": pillar.is_company,
            **_measured(by_pillar.get(pillar.id), unit, whole),
        }
        for pillar in pillars
        if pillar.id in by_pillar
    ]
    if UNASSIGNED_ID in by_pillar:
        rows.append({
            "pillar_id": UNASSIGNED_ID,
            **{k: v for k, v in UNASSIGNED_PILLAR.items() if k != "id"},
            **_measured(by_pillar.get(UNASSIGNED_ID), unit, whole),
        })
    rows.sort(key=lambda row: -row[unit])
    return rows


def _track_rows(categories, by_track: dict, unit: str, whole: int) -> List[dict]:
    """Tracks that carry effort, biggest first."""
    rows = [
        {
            "track_id": category.id,
            "name": category.name.strip(),
            "default_points": category.default_points,
            **_measured(by_track.get(category.id), unit, whole),
        }
        for category in categories
        if category.id in by_track
    ]
    if UNASSIGNED_ID in by_track:
        rows.append({
            "track_id": UNASSIGNED_ID,
            "name": UNASSIGNED_TRACK_NAME,
            "default_points": 0,
            **_measured(by_track.get(UNASSIGNED_ID), unit, whole),
        })
    rows.sort(key=lambda row: -row[unit])
    return rows


def _matrix(track_rows, pillar_rows, by_cell: dict, unit: str, whole: int) -> List[dict]:
    """Every Track x Pillar intersection that has anything in it. Sparse."""
    return [
        {
            "track_id": track["track_id"],
            "pillar_id": pillar["pillar_id"],
            **_measured(by_cell.get((track["track_id"], pillar["pillar_id"])), unit, whole),
        }
        for track in track_rows
        for pillar in pillar_rows
        if (track["track_id"], pillar["pillar_id"]) in by_cell
    ]


def _function_rows(functions, by_function: dict, pillar_by_id: dict,
                   open_for, done_for, unit: str, whole: int) -> List[dict]:
    """Functions with effort or with tasks against them, biggest first.

    A function with no points but with open tasks still belongs here - that is
    exactly the "queued but not started" case worth seeing.
    """
    rows = []
    for function in functions:
        if function.id not in by_function and not open_for(function.id) and not done_for(function.id):
            continue  # nothing earned and nothing pending - not this person's work
        rows.append({
            "function_id": function.id,
            "name": function.name,
            "purpose": function.purpose,
            "color_hex": function.color_hex,
            "pillar_id": function.pillar_id,
            "pillar_name": pillar_by_id[function.pillar_id].name,
            "pillar_slug": pillar_by_id[function.pillar_id].slug,
            "open_tasks": open_for(function.id),
            "completed_tasks": done_for(function.id),
            **_measured(by_function.get(function.id), unit, whole),
        })

    if UNASSIGNED_ID in by_function or open_for(UNASSIGNED_ID) or done_for(UNASSIGNED_ID):
        rows.append({
            "function_id": UNASSIGNED_ID,
            "name": UNASSIGNED_FUNCTION_NAME,
            "purpose": "Work that has not been tagged with a function yet.",
            "color_hex": UNASSIGNED_PILLAR["color_hex"],
            "pillar_id": UNASSIGNED_ID,
            "pillar_name": UNASSIGNED_PILLAR["name"],
            "pillar_slug": UNASSIGNED_PILLAR["slug"],
            "open_tasks": open_for(UNASSIGNED_ID),
            "completed_tasks": done_for(UNASSIGNED_ID),
            **_measured(by_function.get(UNASSIGNED_ID), unit, whole),
        })

    rows.sort(key=lambda row: (-row[unit], row["name"].lower()))
    return rows


def _counters(db: Session, user: Optional[User]):
    """Open and completed task counts per function id, as two lookup callables.

    `user=None` counts the whole company. The callables translate the panel's
    UNASSIGNED_ID back into the SQL NULL it stands for.
    """
    def counts(completed: bool) -> Dict[Optional[int], int]:
        query = db.query(Task.function_id, func.count(Task.id))
        query = query.filter(Task.status == "Completed") if completed \
            else query.filter(Task.status != "Completed")
        if user is not None:
            query = query.filter(Task.user_id == user.id)
        return dict(query.group_by(Task.function_id).all())

    open_counts = counts(completed=False)
    done_counts = counts(completed=True)

    def open_for(function_id: int) -> int:
        return open_counts.get(None if function_id == UNASSIGNED_ID else function_id, 0)

    def done_for(function_id: int) -> int:
        return done_counts.get(None if function_id == UNASSIGNED_ID else function_id, 0)

    return open_counts, done_counts, open_for, done_for


def _ledger(db: Session, user: Optional[User], range_start, range_end):
    """The window's ledger rows, tagged on both axes.

    Outer joins throughout: a ledger row with no task, or a task with no
    function, still has to reach the Unassigned bucket rather than be filtered
    out of existence by an inner join.
    """
    query = (
        db.query(
            PointLedger.user_id,
            PointLedger.points_awarded,
            PointLedger.minutes,
            Task.function_id,
            Task.category_id,
        )
        .outerjoin(Task, Task.id == PointLedger.task_id)
    )
    if user is not None:
        query = query.filter(PointLedger.user_id == user.id)
    if range_start is not None:
        query = query.filter(PointLedger.timestamp >= range_start)
    if range_end is not None:
        query = query.filter(PointLedger.timestamp < range_end)
    return query.all()


def compute_panel(
    db: Session,
    user: User,
    range_start=None,
    range_end=None,
) -> dict:
    """Everything one person's panel renders, over one window.

    `range_start`/`range_end` are a half-open interval (see core.daterange);
    omit both for all time.
    """
    rows = _ledger(db, user, range_start, range_end)
    pillars, functions, categories, pillar_of_function, function_by_id, pillar_by_id, category_by_id = \
        _taxonomy(db)

    by_function: dict = {}
    by_pillar: dict = {}
    by_track: dict = {}
    by_cell: dict = {}

    total_points = 0
    total_minutes = 0
    entries_total = len(rows)
    entries_with_minutes = 0

    for _user_id, points, minutes, function_id, category_id in rows:
        points = points or 0
        if minutes is None:
            minutes = 0
        else:
            entries_with_minutes += 1
        total_minutes += minutes
        total_points += points

        resolved_function = function_id if function_id in function_by_id else UNASSIGNED_ID
        resolved_pillar = pillar_of_function.get(resolved_function, UNASSIGNED_ID)
        resolved_track = category_id if category_id in category_by_id else UNASSIGNED_ID

        _add(by_function, resolved_function, points, minutes)
        _add(by_pillar, resolved_pillar, points, minutes)
        _add(by_track, resolved_track, points, minutes)
        _add(by_cell, (resolved_track, resolved_pillar), points, minutes)

    unit, whole = _resolve_unit(entries_total, entries_with_minutes, total_points, total_minutes)
    open_counts, done_counts, open_for, done_for = _counters(db, user)

    track_rows = _track_rows(categories, by_track, unit, whole)
    pillar_rows = _pillar_rows(pillars, by_pillar, unit, whole)
    function_rows = _function_rows(
        functions, by_function, pillar_by_id, open_for, done_for, unit, whole,
    )

    return {
        "user": {"id": user.id, "name": user.name, "role": user.role},
        "seat": _seat(user, function_by_id, pillar_by_id),
        "unit": unit,
        "totals": {
            "points": total_points,
            "minutes": total_minutes,
            "open_tasks": sum(open_counts.values()),
            "completed_tasks": sum(done_counts.values()),
            # Surfaced so the panel can say why it is still counting in points,
            # and how many entries stand between here and a real time audit.
            "entries": entries_total,
            "entries_with_minutes": entries_with_minutes,
        },
        "headline": _headline(user, by_function, by_pillar, by_track, categories, pillars, unit, whole),
        "tracks": track_rows,
        "pillars": pillar_rows,
        "functions": function_rows,
        "matrix": _matrix(track_rows, pillar_rows, by_cell, unit, whole),
    }


def compute_company_panel(
    db: Session,
    range_start=None,
    range_end=None,
) -> dict:
    """The same rollup with nobody filtered out: where the company's effort went.

    Everything the per-person panel reports is here on the org's ledger rather
    than one account's, plus the two things that only exist at this level:

    * **`people`** - each account's slice of the company total, so a mix that is
      really one person's week does not read as a company direction.
    * **`people_mix`** - the same pillar split per person. Its `share` is a share
      *of that person*, not of the company, because the question it answers is
      "what is this person working on" and a company-relative bar would just
      redraw the headcount.
    """
    rows = _ledger(db, None, range_start, range_end)
    pillars, functions, categories, pillar_of_function, function_by_id, pillar_by_id, category_by_id = \
        _taxonomy(db)

    users = db.query(User).order_by(User.id).all()
    seat_of_user = {u.id: u.home_function_id for u in users}

    by_function: dict = {}
    by_pillar: dict = {}
    by_track: dict = {}
    by_cell: dict = {}
    by_person: dict = {}
    by_person_pillar: dict = {}
    by_person_function: dict = {}
    #: Distinct accounts that logged anything against each function. A function
    #: at 30% carried by one person is a different fact from one carried by four.
    contributors: Dict[int, set] = {}

    total_points = 0
    total_minutes = 0
    entries_total = len(rows)
    entries_with_minutes = 0
    on_seat = {"points": 0, "minutes": 0}

    for user_id, points, minutes, function_id, category_id in rows:
        points = points or 0
        if minutes is None:
            minutes = 0
        else:
            entries_with_minutes += 1
        total_minutes += minutes
        total_points += points

        resolved_function = function_id if function_id in function_by_id else UNASSIGNED_ID
        resolved_pillar = pillar_of_function.get(resolved_function, UNASSIGNED_ID)
        resolved_track = category_id if category_id in category_by_id else UNASSIGNED_ID

        _add(by_function, resolved_function, points, minutes)
        _add(by_pillar, resolved_pillar, points, minutes)
        _add(by_track, resolved_track, points, minutes)
        _add(by_cell, (resolved_track, resolved_pillar), points, minutes)
        _add(by_person, user_id, points, minutes)
        _add(by_person_pillar, (user_id, resolved_pillar), points, minutes)
        _add(by_person_function, (user_id, resolved_function), points, minutes)
        contributors.setdefault(resolved_function, set()).add(user_id)

        # On-seat is only meaningful for tagged work done by a seated account:
        # an untagged row is not evidence of drift, merely of missing tags.
        seat_function = seat_of_user.get(user_id)
        if seat_function is not None and resolved_function == seat_function:
            on_seat["points"] += points
            on_seat["minutes"] += minutes

    unit, whole = _resolve_unit(entries_total, entries_with_minutes, total_points, total_minutes)
    open_counts, done_counts, open_for, done_for = _counters(db, None)

    track_rows = _track_rows(categories, by_track, unit, whole)
    pillar_rows = _pillar_rows(pillars, by_pillar, unit, whole)
    function_rows = _function_rows(
        functions, by_function, pillar_by_id, open_for, done_for, unit, whole,
    )
    for row in function_rows:
        row["contributors"] = len(contributors.get(row["function_id"], ()))

    # --- the people axis --------------------------------------------------
    people_rows = []
    for user in users:
        person = by_person.get(user.id)
        person_open = (
            db.query(func.count(Task.id))
            .filter(Task.user_id == user.id, Task.status != "Completed")
            .scalar()
        ) or 0
        if person is None and not person_open:
            continue  # nothing logged and nothing pending - not part of this window

        seat_function = function_by_id.get(user.home_function_id)
        seat_pillar = pillar_by_id.get(seat_function.pillar_id) if seat_function else None

        # Drift is measured against this person's own total, not the company's:
        # "half of what I did was off-seat" survives someone else having a big
        # week, which a company-relative figure would not. None rather than 0
        # when there is no seat - "we never said where they belong" and "they
        # never went there" are different facts.
        # A seated account that logged nothing gets None too, not 0%: "none of
        # their effort was on-seat" is a claim about effort that did not happen.
        person_total = (person or {}).get(unit, 0)
        if seat_function is None or not person_total:
            on_seat_share = None
        else:
            seat_amount = (by_person_function.get((user.id, seat_function.id)) or {}).get(unit, 0)
            on_seat_share = _share(seat_amount, person_total)

        people_rows.append({
            "user_id": user.id,
            "name": user.name,
            "role": user.role,
            "seat_function_id": seat_function.id if seat_function else None,
            "seat_function_name": seat_function.name if seat_function else None,
            "seat_pillar_name": seat_pillar.name if seat_pillar else None,
            "seat_pillar_slug": seat_pillar.slug if seat_pillar else None,
            "open_tasks": person_open,
            "on_seat_share": on_seat_share,
            **_measured(person, unit, whole),
        })

    people_rows.sort(key=lambda row: (-row[unit], row["name"].lower()))

    people_mix = []
    for user_id, pillar_id in by_person_pillar:
        person_total = (by_person.get(user_id) or {}).get(unit, 0)
        people_mix.append({
            "user_id": user_id,
            "pillar_id": pillar_id,
            **_measured(by_person_pillar[(user_id, pillar_id)], unit, person_total),
        })

    return {
        "unit": unit,
        "totals": {
            "points": total_points,
            "minutes": total_minutes,
            "open_tasks": sum(open_counts.values()),
            "completed_tasks": sum(done_counts.values()),
            "entries": entries_total,
            "entries_with_minutes": entries_with_minutes,
            "people": len([p for p in people_rows if p["points"] or p["minutes"]]),
            "seated_people": len([u for u in users if u.home_function_id]),
        },
        "headline": _company_headline(
            by_pillar, by_track, by_function, categories, pillars,
            on_seat, unit, whole, function_rows, pillar_rows,
        ),
        "tracks": track_rows,
        "pillars": pillar_rows,
        "functions": function_rows,
        "matrix": _matrix(track_rows, pillar_rows, by_cell, unit, whole),
        "people": people_rows,
        "people_mix": people_mix,
    }


def _seat(user: User, function_by_id: dict, pillar_by_id: dict) -> Optional[dict]:
    """The fixed place, or None. A missing seat is normal, not an error."""
    function = function_by_id.get(user.home_function_id)
    if function is None:
        return None
    pillar = pillar_by_id.get(function.pillar_id)
    return {
        "function_id": function.id,
        "function_name": function.name,
        "purpose": function.purpose,
        "color_hex": function.color_hex,
        "pillar_id": pillar.id if pillar else None,
        "pillar_name": pillar.name if pillar else None,
        "pillar_slug": pillar.slug if pillar else None,
    }


def _headline(user, by_function, by_pillar, by_track, categories, pillars, unit, whole) -> dict:
    """The two numbers a pre-PMF founder actually opens this page for.

    `core_share` is how much of the window went into the track that moves the
    company forward. `build_vs_sell` splits that Core effort between Product and
    Customer - the classic pre-PMF failure is all of it landing on the Product
    side, which is invisible until someone puts the two numbers next to each
    other. `on_seat_share` is how much of the effort happened in the function
    this person is actually supposed to be working in.
    """
    core_amount = _core_amount(by_track, categories, unit)
    product, customer, build_sell_whole = _build_sell(by_pillar, pillars, unit)
    seat_entry = by_function.get(user.home_function_id) if user.home_function_id else None

    return {
        "core_share": _share(core_amount, whole),
        "product_share_of_build_sell": _share(product, build_sell_whole),
        "customer_share_of_build_sell": _share(customer, build_sell_whole),
        "has_build_sell": build_sell_whole > 0,
        "on_seat_share": _share((seat_entry or {}).get(unit, 0), whole) if user.home_function_id else None,
    }


def _company_headline(by_pillar, by_track, by_function, categories, pillars,
                      on_seat, unit, whole, function_rows, pillar_rows) -> dict:
    """What the company was actually pointed at this window.

    Same two founder numbers as the personal headline, plus the three that only
    make sense in aggregate: how concentrated the effort was, how much of it
    happened where people are meant to be, and how much of it could not be
    attributed at all. `untagged_share` is deliberately part of the headline
    rather than a footnote - a focus chart built from 80% untagged work is
    describing the tagging.
    """
    core_amount = _core_amount(by_track, categories, unit)
    product, customer, build_sell_whole = _build_sell(by_pillar, pillars, unit)

    top_pillar = next((row for row in pillar_rows if row["pillar_id"] != UNASSIGNED_ID), None)
    top_function = next((row for row in function_rows if row["function_id"] != UNASSIGNED_ID
                         and (row["points"] or row["minutes"])), None)
    untagged = (by_function.get(UNASSIGNED_ID) or {}).get(unit, 0)

    return {
        "core_share": _share(core_amount, whole),
        "product_share_of_build_sell": _share(product, build_sell_whole),
        "customer_share_of_build_sell": _share(customer, build_sell_whole),
        "has_build_sell": build_sell_whole > 0,
        "on_seat_share": _share(on_seat[unit], whole),
        "untagged_share": _share(untagged, whole),
        "top_pillar_name": top_pillar["name"] if top_pillar else None,
        "top_pillar_slug": top_pillar["slug"] if top_pillar else None,
        "top_pillar_share": top_pillar["share"] if top_pillar else None,
        "top_function_name": top_function["name"] if top_function else None,
        "top_function_pillar_slug": top_function["pillar_slug"] if top_function else None,
        "top_function_share": top_function["share"] if top_function else None,
    }


def _core_amount(by_track, categories, unit: str) -> int:
    """Effort in the Core track. Zero when no such category exists."""
    core = next((c for c in categories if c.name.strip().lower() == "core"), None)
    return ((by_track.get(core.id) if core else None) or {}).get(unit, 0)


def _build_sell(by_pillar, pillars, unit: str) -> Tuple[int, int, int]:
    """Product and Customer effort, and their sum.

    Deliberately measured across the whole window rather than inside Core: the
    ledger row carries one track and one pillar, but the rollup buckets them
    independently, so a true "Core AND Product" figure would need the cell. The
    cell is in the matrix; this is the honest headline version of it.
    """
    def pillar_amount(slug: str) -> int:
        pillar = next((p for p in pillars if p.slug == slug), None)
        if pillar is None:
            return 0
        return (by_pillar.get(pillar.id) or {}).get(unit, 0)

    product = pillar_amount("product")
    customer = pillar_amount("customer")
    return product, customer, product + customer


def compute_open_tasks(db: Session, user: User, limit: int = 20) -> List[dict]:
    """This person's pending work, tagged on both axes, in board order."""
    rows = (
        db.query(Task, Category, Function, Pillar)
        .outerjoin(Category, Category.id == Task.category_id)
        .outerjoin(Function, Function.id == Task.function_id)
        .outerjoin(Pillar, Pillar.id == Function.pillar_id)
        .filter(Task.user_id == user.id, Task.status != "Completed")
        .order_by(Task.position, Task.id)
        .limit(limit)
        .all()
    )
    return [
        {
            "task_id": task.id,
            "title": task.title,
            "track_name": category.name.strip() if category else UNASSIGNED_TRACK_NAME,
            "function_name": function.name if function else UNASSIGNED_FUNCTION_NAME,
            "pillar_name": pillar.name if pillar else UNASSIGNED_PILLAR["name"],
            "pillar_slug": pillar.slug if pillar else UNASSIGNED_PILLAR["slug"],
            "color_hex": function.color_hex if function else UNASSIGNED_PILLAR["color_hex"],
            "points": task.points if task.points is not None
                      else (category.default_points if category else 0),
        }
        for task, category, function, pillar in rows
    ]
