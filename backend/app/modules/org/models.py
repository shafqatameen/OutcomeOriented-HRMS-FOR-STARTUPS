"""The domain axis: which part of the business a piece of work belongs to.

This is deliberately *not* the same thing as a Category. A Category answers
"is this moving me forward?" (Core, Adjacent, Spiritual, Drain) and prices the
task through its default_points. A Function answers "what kind of work is
this?" (Sales, R&D, Finance). Neither can be derived from the other - coding is
Core/R&D when it is the product and Adjacent/R&D when it is a side experiment -
so a task carries one of each and the panel crosses them.

Pillar -> Function is only two levels because the source spreadsheet's third
level carried no information: fourteen of its fifteen functions had exactly one
sub-function whose text was just the function's purpose sentence. That sentence
lives in Function.purpose instead. The CEO pillar, which genuinely had six, gets
six functions.
"""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.base import Base


class Pillar(Base):
    """One of the top-level halves of a founder's life. Seeded from the sheet."""
    __tablename__ = "pillars"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    #: Stable machine name. The panel keys its colour and copy off this, so
    #: renaming a pillar in the admin UI never breaks the display.
    slug = Column(String, unique=True, nullable=False, index=True)
    #: The source spreadsheet's own cell fill, kept so the app and the sheet
    #: stay recognisably the same system.
    color_hex = Column(String, nullable=False, server_default="#666666")
    position = Column(Integer, nullable=False, server_default="0", index=True)
    #: False for Life. Company-share figures divide by the company pillars only,
    #: so sleeping eight hours cannot dilute "how much of my work was Core".
    is_company = Column(Boolean, nullable=False, server_default="1")

    functions = relationship(
        "app.modules.org.models.Function",
        back_populates="pillar",
        order_by="app.modules.org.models.Function.position",
    )


class Function(Base):
    """An essential function inside a pillar. What a task is tagged with."""
    __tablename__ = "functions"

    id = Column(Integer, primary_key=True, index=True)
    pillar_id = Column(Integer, ForeignKey("pillars.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    #: The sheet's "Purpose / Sub-Function" sentence.
    purpose = Column(Text, nullable=True)
    color_hex = Column(String, nullable=False, server_default="#666666")
    position = Column(Integer, nullable=False, server_default="0", index=True)

    pillar = relationship("app.modules.org.models.Pillar", back_populates="functions")
    tasks = relationship("app.modules.tasks.models.Task", back_populates="function")
    seated_users = relationship("app.modules.users.models.User", back_populates="home_function")
