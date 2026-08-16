"""The holding lists an inbox item can be clarified into.

Three tables rather than one `items` table with a `kind` column, and that is the
whole design. The GTD material this app follows is blunt about why:

    it's critical that all of these categories be kept pristinely distinct from
    one another... if they lose their edges and begin to blend, much of the
    value of organizing will be lost.

A single shared table forces every column nullable, and once they are nullable
the schema can represent a Waiting item with nobody to wait on and a Reference
note with a due date. Separate tables let each list require exactly what it
means and hold nothing it does not:

    Someday    a possibility you have *not* committed to. No date, no context,
               no assignee - the absence is the point. Adding a due date to a
               someday item is how it stops being one.
    Reference  material, not a commitment. Has a body; has no status at all,
               because there is nothing about it to be done or not done.
    Waiting    work that is somebody else's move. Always has a delegate and a
               date it started, or it is not a waiting item, it is just a task
               you are avoiding.

All three are private to their owner, exactly as `inbox_items` is, and for a
sharper reason: a Someday list is where "maybe leave and start something else"
gets written down. It only ever gets written down if nobody else can read it.
No router in this module accepts a user id - see router.py.
"""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.base import Base
from app.modules.tasks.models import get_ist_now


class SomedayItem(Base):
    """A possibility, explicitly not a commitment."""
    __tablename__ = "someday_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_ist_now, nullable=False, index=True)
    #: When this was last actually looked at during a review.
    #:
    #: Null until the first one, which is meaningful rather than missing: it
    #: marks an item that has never been reconsidered since capture. The weekly
    #: review exists partly to surface the possibilities that have sat here
    #: longest, since the cheat sheet's instruction is to delete the ones the
    #: world has moved past - and you cannot spot those without this column.
    last_reviewed_at = Column(DateTime, nullable=True)

    user = relationship("app.modules.users.models.User")


class ReferenceItem(Base):
    """Material to find later. Carries no status, deliberately."""
    __tablename__ = "reference_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    #: Not nullable: reference with no content is a title pretending to be a
    #: note, and it will never be worth opening.
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=get_ist_now, nullable=False, index=True)

    user = relationship("app.modules.users.models.User")


class WaitingItem(Base):
    """Something delegated, and the fact that you are still owed it."""
    __tablename__ = "waiting_items"

    id = Column(Integer, primary_key=True, index=True)
    #: The person waiting - the owner of this reminder, not the person who owes.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    #: Who owes it, when they hold an account here. Nullable because plenty of
    #: what you wait on is owed by a supplier, a client or a bank that will
    #: never have a login - and a waiting list that can only name colleagues
    #: would push exactly those items back into somebody's head.
    delegate_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    #: Who owes it, always, as text. Not nullable - this is the field that makes
    #: the row a waiting item at all. Copied from the account when one is given,
    #: so the list still reads correctly if that account is later renamed or
    #: deleted: what matters historically is who you were waiting on at the time.
    delegate_name = Column(String, nullable=False)
    #: How long it has been outstanding, which is the only number this list is
    #: really for. Set at creation and never edited.
    waiting_since = Column(DateTime, default=get_ist_now, nullable=False, index=True)
    #: When to chase it. Nullable - not everything owed needs a chase date, and
    #: inventing one for everything is how a follow-up list becomes noise.
    follow_up_date = Column(Date, nullable=True, index=True)
    #: "Open" or "Closed". Closing means it arrived, or you stopped waiting -
    #: the distinction is not worth a column, because either way it is no longer
    #: yours to chase.
    status = Column(String, nullable=False, server_default="Open", default="Open", index=True)
    closed_at = Column(DateTime, nullable=True)

    user = relationship(
        "app.modules.users.models.User", foreign_keys=[user_id]
    )
    delegate = relationship(
        "app.modules.users.models.User", foreign_keys=[delegate_user_id]
    )
