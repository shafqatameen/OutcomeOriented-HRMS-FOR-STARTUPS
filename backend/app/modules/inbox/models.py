"""Capture: the one place an open loop lands before anyone decides anything.

This table is deliberately, almost aggressively, dumb. It holds a person, some
text, and when it arrived. It has no category, no points, no assignee, no due
date, no status, and no position - and it must stay that way.

The reason is GTD's, not ours: the whole method rests on capture being faster
than the urge to skip it. Every field added here is one more decision demanded
at the moment of typing, and a capture form that asks questions is a capture
form people route around by keeping the thought in their head instead - which is
the exact failure the inbox exists to prevent.

An inbox item is therefore not a task and cannot become one by editing. It has
no completion; the only ways out are to be clarified into some other bucket
(phase 2) or discarded. That asymmetry is the point: it stops the inbox
degrading into a second task list that nobody processes.

Privacy is structural, not conventional. Every row belongs to exactly one
account and no endpoint in this module accepts a user id - see router.py. An
unprocessed inbox is the most unguarded thing a person puts into this app, and
it only stays that way if nobody else can read it.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.core.base import Base
# The app's clock lives with the ledger that first needed it. Imported rather
# than re-declared so a captured item and a completed task can never disagree
# about what "today" means.
from app.modules.tasks.models import get_ist_now


class InboxItem(Base):
    __tablename__ = "inbox_items"

    id = Column(Integer, primary_key=True, index=True)
    #: The owner, and the only account that may ever read this row.
    #:
    #: Not nullable, unlike most of the tags elsewhere in the schema: an inbox
    #: item with no owner is not a partially-tagged item, it is a private
    #: thought with nobody to return it to.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    #: Whatever was on their mind, verbatim. Text rather than String because a
    #: capture is as often a paragraph as a phrase, and truncating someone's
    #: thought to fit a column would defeat the purpose of capturing it.
    body = Column(Text, nullable=False)
    #: Indexed because the inbox is always read oldest-first - clarifying works
    #: top item down, one at a time, to zero - so this is the sort key on every
    #: read of the table.
    created_at = Column(DateTime, default=get_ist_now, nullable=False, index=True)

    user = relationship("app.modules.users.models.User")
