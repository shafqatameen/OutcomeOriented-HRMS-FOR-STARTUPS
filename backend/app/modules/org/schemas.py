from typing import List, Optional

from pydantic import BaseModel


class FunctionBase(BaseModel):
    name: str
    purpose: Optional[str] = None
    color_hex: str = "#666666"
    position: int = 0


class FunctionCreate(FunctionBase):
    pillar_id: int


class FunctionUpdate(BaseModel):
    """Partial edit. Omitted fields are left alone; see tasks.schemas.TaskUpdate."""
    name: Optional[str] = None
    purpose: Optional[str] = None
    color_hex: Optional[str] = None
    position: Optional[int] = None
    #: Moving a function to another pillar re-buckets every task tagged with it,
    #: including completed ones. Deliberate - see the note on org.router.
    pillar_id: Optional[int] = None


class Function(FunctionBase):
    id: int
    pillar_id: int

    class Config:
        from_attributes = True


class PillarBase(BaseModel):
    name: str
    color_hex: str = "#666666"
    position: int = 0
    is_company: bool = True


class PillarCreate(PillarBase):
    slug: str


class PillarUpdate(BaseModel):
    name: Optional[str] = None
    color_hex: Optional[str] = None
    position: Optional[int] = None
    is_company: Optional[bool] = None
    # Slug is absent on purpose: the panel keys colour and copy off it, so it is
    # an identity, not a label. Rename the pillar instead.


class Pillar(PillarBase):
    id: int
    slug: str

    class Config:
        from_attributes = True


class PillarWithFunctions(Pillar):
    functions: List[Function] = []


class FunctionUsage(BaseModel):
    """What deleting a function would have to deal with, asked before confirming."""
    function_id: int
    name: str
    task_count: int
    seated_user_count: int


class PillarUsage(BaseModel):
    pillar_id: int
    name: str
    function_count: int
    task_count: int
