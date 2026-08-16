"""Read and edit the domain axis: pillars and the functions inside them.

The tree is readable by anyone signed in, because the panel, the task forms and
the nav all render function names. Editing it needs `admin.taxonomy`.

Re-parenting or renaming is allowed and takes effect retroactively: the panel
rollup reads the *current* taxonomy, so moving Finance from Business to CEO
re-buckets every point ever earned under it. That is the same rule categories
already follow - changing a category's default_points retroactively changes what
its uncompleted tasks are worth - and it is the only rule that keeps one task
from being two different things depending on when you look at it.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.integrity import Blocker, deletion_blocked
from app.modules.auth.dependencies import require_permission, require_user
from app.modules.org import models, schemas
from app.modules.tasks import models as task_models
from app.modules.users import models as user_models

router = APIRouter(prefix="/org", tags=["Org"])


def _ordered_pillars(db: Session) -> List[models.Pillar]:
    return db.query(models.Pillar).order_by(models.Pillar.position, models.Pillar.id).all()


def _get_pillar(db: Session, pillar_id: int) -> models.Pillar:
    pillar = db.query(models.Pillar).filter(models.Pillar.id == pillar_id).first()
    if not pillar:
        raise HTTPException(status_code=404, detail="Pillar not found")
    return pillar


def _get_function(db: Session, function_id: int) -> models.Function:
    function = db.query(models.Function).filter(models.Function.id == function_id).first()
    if not function:
        raise HTTPException(status_code=404, detail="Function not found")
    return function


@router.get("/tree", response_model=List[schemas.PillarWithFunctions])
def read_tree(db: Session = Depends(get_db), _user=Depends(require_user)):
    """The whole taxonomy, nested and ordered. One call feeds every consumer."""
    pillars = _ordered_pillars(db)
    functions = (
        db.query(models.Function)
        .order_by(models.Function.position, models.Function.id)
        .all()
    )

    by_pillar: dict = {}
    for function in functions:
        by_pillar.setdefault(function.pillar_id, []).append(function)

    return [
        {
            "id": pillar.id,
            "name": pillar.name,
            "slug": pillar.slug,
            "color_hex": pillar.color_hex,
            "position": pillar.position,
            "is_company": pillar.is_company,
            "functions": by_pillar.get(pillar.id, []),
        }
        for pillar in pillars
    ]


@router.get("/pillars", response_model=List[schemas.Pillar])
def read_pillars(db: Session = Depends(get_db), _user=Depends(require_user)):
    return _ordered_pillars(db)


@router.post("/pillars", response_model=schemas.Pillar)
def create_pillar(
    pillar: schemas.PillarCreate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    name = pillar.name.strip()
    slug = pillar.slug.strip().lower()
    if not name or not slug:
        raise HTTPException(status_code=400, detail="Name and slug are required")

    clash = (
        db.query(models.Pillar)
        .filter((models.Pillar.name == name) | (models.Pillar.slug == slug))
        .first()
    )
    if clash:
        raise HTTPException(status_code=400, detail="A pillar with that name or slug already exists")

    db_pillar = models.Pillar(
        name=name, slug=slug, color_hex=pillar.color_hex,
        position=pillar.position, is_company=pillar.is_company,
    )
    db.add(db_pillar)
    db.commit()
    db.refresh(db_pillar)
    return db_pillar


@router.patch("/pillars/{pillar_id}", response_model=schemas.Pillar)
def update_pillar(
    pillar_id: int,
    update: schemas.PillarUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    pillar = _get_pillar(db, pillar_id)
    sent = update.model_fields_set
    if not sent:
        raise HTTPException(status_code=400, detail="Provide at least one field to update")

    if "name" in sent:
        name = (update.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name must not be empty")
        taken = (
            db.query(models.Pillar)
            .filter(models.Pillar.name == name, models.Pillar.id != pillar_id)
            .first()
        )
        if taken:
            raise HTTPException(status_code=400, detail="A pillar with that name already exists")
        pillar.name = name

    if "color_hex" in sent and update.color_hex:
        pillar.color_hex = update.color_hex
    if "position" in sent and update.position is not None:
        pillar.position = update.position
    if "is_company" in sent and update.is_company is not None:
        pillar.is_company = update.is_company

    db.commit()
    db.refresh(pillar)
    return pillar


@router.get("/pillars/{pillar_id}/usage", response_model=schemas.PillarUsage)
def read_pillar_usage(
    pillar_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    pillar = _get_pillar(db, pillar_id)
    function_ids = [
        row[0] for row in db.query(models.Function.id).filter(models.Function.pillar_id == pillar_id)
    ]
    task_count = (
        db.query(task_models.Task).filter(task_models.Task.function_id.in_(function_ids)).count()
        if function_ids
        else 0
    )
    return {
        "pillar_id": pillar.id,
        "name": pillar.name,
        "function_count": len(function_ids),
        "task_count": task_count,
    }


@router.delete("/pillars/{pillar_id}")
def delete_pillar(
    pillar_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    """Deletes an empty pillar, refusing while any function still belongs to it.

    Nothing at the storage layer would stop this: SQLite runs without
    `PRAGMA foreign_keys` (see core.database), so the functions would simply be
    left pointing at a pillar id that no longer resolves, and every task tagged
    with them would silently drop out of the panel's mix.
    """
    pillar = _get_pillar(db, pillar_id)
    function_count = db.query(models.Function).filter(models.Function.pillar_id == pillar_id).count()

    if function_count:
        raise deletion_blocked(
            entity="pillar",
            name=pillar.name,
            blockers=[Blocker("functions", function_count)],
            remedy="Move or delete those functions first.",
        )

    db.delete(pillar)
    db.commit()
    return {"message": "Pillar deleted", "pillar_id": pillar_id}


@router.get("/functions", response_model=List[schemas.Function])
def read_functions(db: Session = Depends(get_db), _user=Depends(require_user)):
    return db.query(models.Function).order_by(models.Function.position, models.Function.id).all()


@router.post("/functions", response_model=schemas.Function)
def create_function(
    function: schemas.FunctionCreate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    _get_pillar(db, function.pillar_id)

    name = function.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name must not be empty")

    # Unique per pillar, not globally: "Grow Brand" is legitimately both a CEO
    # function and a Marketing task in the source spreadsheet, and two pillars
    # may reasonably each want an "Operations".
    taken = (
        db.query(models.Function)
        .filter(models.Function.pillar_id == function.pillar_id, models.Function.name == name)
        .first()
    )
    if taken:
        raise HTTPException(status_code=400, detail="That pillar already has a function with this name")

    db_function = models.Function(
        pillar_id=function.pillar_id, name=name, purpose=function.purpose,
        color_hex=function.color_hex, position=function.position,
    )
    db.add(db_function)
    db.commit()
    db.refresh(db_function)
    return db_function


@router.patch("/functions/{function_id}", response_model=schemas.Function)
def update_function(
    function_id: int,
    update: schemas.FunctionUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    function = _get_function(db, function_id)
    sent = update.model_fields_set
    if not sent:
        raise HTTPException(status_code=400, detail="Provide at least one field to update")

    target_pillar_id = function.pillar_id
    if "pillar_id" in sent:
        if update.pillar_id is None:
            raise HTTPException(status_code=400, detail="A function must belong to a pillar")
        _get_pillar(db, update.pillar_id)
        target_pillar_id = update.pillar_id

    target_name = function.name
    if "name" in sent:
        target_name = (update.name or "").strip()
        if not target_name:
            raise HTTPException(status_code=400, detail="Name must not be empty")

    if "name" in sent or "pillar_id" in sent:
        taken = (
            db.query(models.Function)
            .filter(
                models.Function.pillar_id == target_pillar_id,
                models.Function.name == target_name,
                models.Function.id != function_id,
            )
            .first()
        )
        if taken:
            raise HTTPException(
                status_code=400, detail="That pillar already has a function with this name"
            )

    function.pillar_id = target_pillar_id
    function.name = target_name
    if "purpose" in sent:
        function.purpose = update.purpose
    if "color_hex" in sent and update.color_hex:
        function.color_hex = update.color_hex
    if "position" in sent and update.position is not None:
        function.position = update.position

    db.commit()
    db.refresh(function)
    return function


@router.get("/functions/{function_id}/usage", response_model=schemas.FunctionUsage)
def read_function_usage(
    function_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    function = _get_function(db, function_id)
    return {
        "function_id": function.id,
        "name": function.name,
        "task_count": db.query(task_models.Task)
            .filter(task_models.Task.function_id == function_id).count(),
        "seated_user_count": db.query(user_models.User)
            .filter(user_models.User.home_function_id == function_id).count(),
    }


@router.delete("/functions/{function_id}")
def delete_function(
    function_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("admin.taxonomy")),
):
    """Deletes a function nothing points at.

    Tasks are a hard blocker even though `function_id` is nullable: silently
    untagging completed work would move points out of a pillar without leaving
    any record of where they used to be, and the panel is computed from exactly
    that tag. A seated account blocks it too - deleting the function would leave
    that person with a seat pointing nowhere.
    """
    function = _get_function(db, function_id)

    task_count = db.query(task_models.Task).filter(task_models.Task.function_id == function_id).count()
    seated_count = (
        db.query(user_models.User).filter(user_models.User.home_function_id == function_id).count()
    )

    blockers = []
    if task_count:
        blockers.append(Blocker("tasks", task_count, "tagged with this function"))
    if seated_count:
        blockers.append(Blocker("seated accounts", seated_count, "have this as their fixed place"))

    if blockers:
        raise deletion_blocked(
            entity="function",
            name=function.name,
            blockers=blockers,
            remedy="Retag those tasks and move those seats first, or rename this function instead.",
        )

    db.delete(function)
    db.commit()
    return {"message": "Function deleted", "function_id": function_id}
