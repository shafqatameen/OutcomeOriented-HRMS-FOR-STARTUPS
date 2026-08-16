# Plan: turning OutcomeOriented into a GTD operating system

Status: Phases 1–3 shipped, except Calendar. Phases 4–9 still proposal.
The four questions in §11 remain open and block Phase 5 onward.

---

## 0. The headline decision

**Extend OutcomeOriented. Do not build "MyUniverse" as a new application.**

The reason is not effort saved on auth and deployment — that is the small part.
It is that the existing schema already encodes GTD's two hardest levels, and
they were built from a real spreadsheet rather than from a blog post about GTD.

Mapping the cheat sheet's horizon model onto what is already in the database:

| GTD horizon | Cheat sheet | Already in this repo |
|---|---|---|
| Horizon 5 | Purpose & principles | — missing |
| Horizon 4 | Vision (3–5 yr) | — missing |
| Horizon 3 | Goals (1–2 yr) | `goals.Goal` |
| Horizon 2 | Areas of focus & accountabilities | `org.Pillar` → `org.Function` |
| Horizon 1 | Current projects | `goals.Milestone` (close, see §4) |
| Ground | Current actions | `tasks.Task` |

Horizon 2 in particular is the level most GTD apps never get right, because it
asks the user to invent their own areas of focus on a blank screen. You already
have fifteen functions across named pillars, each with a purpose sentence, plus
a **seat** (`User.home_function_id`) and a drift measurement against it. That is
further than the plan in the brief would have got in six phases.

What is genuinely missing is the entire **left side** of GTD — capture, clarify,
and the distinct holding lists. That is the work.

### What building fresh would cost you

You would rebuild auth, the permission catalogue, the sortable board, the
Alembic setup, the export registry, and the aaPanel deploy scripts, in order to
arrive at a task manager with *less* structural insight than the one you have.
The GTD material's own warning applies: *"Don't invest in tools, invest in
habits."*

### The one honest argument for a fresh start

OutcomeOriented is a **team accountability system**: an admin assigns work,
completion mints points into an append-only ledger, and a leaderboard ranks
people. GTD is a **personal trust system**: you capture your own open loops,
nobody assigns them, and items move freely until they are clarified.

Those are different products wearing similar nouns. §2 is about reconciling
them, and it is the real design work in this plan. If after reading §2 you
decide the two shouldn't share a database, the phases below still apply — they
just target a new app.

---

## 1. What is actually missing

Concretely, against the current code:

| Need | Status |
|---|---|
| Inbox / capture | Missing entirely. `POST /tasks` requires `admin.tasks`. |
| Clarify workflow | Missing entirely. |
| Waiting / Delegate | Missing. `Task.user_id` exists but carries no "waiting since". |
| Someday / Maybe | Missing. |
| Reference | Missing. |
| Calendar (time-fixed only) | Missing. No date column exists anywhere. |
| Contexts (`@computer`, `@phone`) | Missing. |
| Time / energy estimates | Missing (`PointLedger.minutes` records actuals only). |
| Next action *vs* project | Blurred — see §4. |
| Weekly review | Missing. |
| Vision / Purpose | Missing. |
| Notes / descriptions | Missing. `Task` has `title` and nothing else. |
| Due dates | Missing. |

Note the last two. `Task` today is `title, user, category, milestone, function,
points, status, position, is_recurring` — deliberately lean. Every date, note,
and tag in the brief is a new column.

---

## 2. The four conflicts, and how to resolve each

These are the decisions that must be made before any schema is written. Each
one is a genuine fork, not a detail.

### 2.1 Assignment vs capture

**Conflict.** `POST /tasks` is gated behind `admin.tasks`. GTD requires that
capture be instant and unrestricted — the cheat sheet is explicit that open
loops kept in the head are the actual problem, and any friction at capture
means they stay in the head.

**Resolution.** Capture is not task creation. Add a *separate* `inbox_items`
table and a `capture.write` permission granted to everyone by default. An inbox
item is deliberately dumb: a user, a body of text, a created timestamp, and
nothing else. It has no category, no points, no assignee, no due date. It cannot
be completed. It becomes a task only by passing through Clarify (§3), and the
existing `admin.tasks` gate stays exactly where it is for work assigned *to
other people*.

This keeps the two systems distinct at the point where they'd otherwise collide:
**assigning work to someone else stays privileged; capturing your own open loop
never is.**

### 2.2 Ownership: personal or shared?

**Conflict.** Everything in the current schema is global. `Category.name` is
globally unique. Tasks belong to a user only in the sense of being *assigned* to
them. A GTD Someday/Maybe list, by contrast, is nobody's business but its
owner's — a leaderboard that surfaced "maybe start a YouTube channel" would kill
the system's trustworthiness immediately, and GTD only works if you trust it
enough to put everything in it.

**Resolution.** Split by bucket, not by table:

- **Private to the owner, never on any shared view:** Inbox, Someday/Maybe,
  Reference, Notes, and the Purpose/Vision horizons.
- **Shared, as today:** Next Actions, Projects, Goals, Pillars, the leaderboard,
  the panel.

Enforce this with a `visibility` column defaulted from the bucket, not by
convention. Add the check to the export registry too, or the first Excel export
leaks somebody's Someday list to the whole company.

### 2.3 The ledger is append-only; GTD items move

**Conflict.** Completion currently mints points and is irreversible by design —
the README calls it "the point of no return", and that rule is correct for
accountability. But in GTD you routinely discover that a completed thing wasn't
done, or that a Next Action was really a Project.

**Resolution.** Keep the ledger append-only; it is one of the better decisions
in this codebase. Handle un-completion with a **reversing entry** (negative
`points_awarded`, same `task_id`) rather than a delete, exactly as double-entry
bookkeeping does. The leaderboard total stays a `SUM` and stays honest, and the
history shows both the completion and the reversal — which is itself useful
during a weekly review.

Movement between *buckets* is unaffected, because bucket changes happen before
completion, not after.

### 2.4 Points vs. GTD's deliberate refusal to prioritise

**Conflict.** Points reward doing whatever is worth the most. GTD's engage model
says the right next action is decided by **context, time available, energy
available, and only then priority** — and the cheat sheet is pointed about the
failure mode of chasing whatever feels urgent.

**Resolution.** Do not let points drive the Engage view's sort order. Points
stay as the retrospective scoring layer they already are (leaderboard, panel,
ledger). The Engage view (§5.4) filters by the four criteria and never sorts by
points. They answer different questions — *what did my week consist of* versus
*what do I do in the next twenty minutes* — and merging them ruins both.

The existing panel service already models this tension well for points vs.
minutes; the same instinct applies here.

---

## 3. Data model

The brief proposes one `Card` object carrying every field, with a `list` column
saying where it sits. **Do not do this.** The cheat sheet's organizing section
gives the reason directly:

> it's critical that all of these categories be kept pristinely distinct from
> one another... if they lose their edges and begin to blend, much of the value
> of organizing will be lost.

A single card table with a nullable everything means a Calendar entry with no
time, a Waiting item with no one to wait on, and a Next Action that is secretly
a project — all representable, all invalid. That is how a GTD app decays into
Trello with GTD-flavoured column names.

### 3.1 Shape

Use a discriminated model: one table for the shared identity and per-bucket
required fields enforced at write time.

```
inbox_items          user, body, created_at              -- no other fields, ever
                     |
                     | clarify
                     v
   +--------+--------+---------+----------+-----------+
   |        |        |         |          |           |
 trash   reference someday  calendar   waiting    actionable
                                                      |
                                            +---------+---------+
                                            |                   |
                                       next_action           project
                                     (tasks.Task)      (goals.Milestone, §4)
```

Per-bucket invariants, enforced in the router, not just the UI:

| Bucket | Must have | Must not have |
|---|---|---|
| Calendar | a fixed start datetime | a "do it sometime" flag |
| Waiting | a delegate + `waiting_since` | own completion by you |
| Next action | a context + belongs to exactly one project or is standalone | sub-steps |
| Project | an outcome statement + ≥1 open next action | a points value of its own |
| Someday | nothing | a due date, a context, an assignee |
| Reference | a body | any status at all |

The "Project must have ≥1 open next action" rule is the single most valuable
constraint in the system — it is what the weekly review checks, and it is what
stops the projects list from silently becoming a wish list.

### 3.2 New columns on `tasks.Task`

```
context_id      FK -> contexts        @computer, @phone, @office, @errands
energy          enum low|medium|high
minutes_estimate int                  pairs with the existing actual minutes
due_date        date, nullable        a real deadline, not a soft wish
defer_until     date, nullable        hides it from Engage until then
notes           text, nullable
```

`due_date` and `defer_until` must stay distinct. Conflating them is why most
task apps show you thirty "overdue" items you were never actually late on.

### 3.3 New tables

```
inbox_items       capture only, per §2.1
contexts          the @ list; small, per-user
waiting_items     what was delegated, to whom, since when, follow-up date
someday_items     title, notes, created_at, last_reviewed_at
reference_items   title, body, tags
calendar_events   title, starts_at, ends_at, all_day
horizons          purpose / vision rows above goals (§7)
review_sessions   one row per weekly review, with counts at the time
habits            + habit_entries, per §8
tags / item_tags  polymorphic
```

`last_reviewed_at` on Someday exists so the weekly review can surface the ones
that have sat untouched for months, which is exactly what the cheat sheet's
"Get Creative" step asks you to prune.

---

## 4. Promote `Milestone` to `Project` — don't add a third layer

Today: `Goal → Milestone → Task`.

GTD defines a project as *any outcome requiring more than one step that you're
committed to within a year*. That is precisely what `Milestone` already is: it
sits under a Goal, it has a status, and Tasks hang off it.

The brief would add a separate `projects` table, producing
`Goal → Milestone → Project → Task`. Four levels where three carry meaning, and
users will never keep the middle two apart.

**Recommendation:** rename `Milestone` to `Project` and give it the natural
planning model's fields:

```
purpose      text    why (Horizon 5, scoped to this project)
outcome      text    what "done" looks like
brainstorm   text    freeform, from the brainstorming step
status       enum    active | on_hold | done
```

Then the natural planning model from the cheat sheet becomes the project
detail page, top to bottom, in order: Purpose → Outcome → Brainstorm →
Organise (components/milestones as a checklist) → Next Actions (real `Task`
rows). The five steps are already the page layout; nothing needs inventing.

This is a rename plus columns, not a new hierarchy. It costs one migration and
some frontend copy, and it removes a whole concept from the user's head.

---

## 5. Screens, and the one that matters

### 5.1 Not a nine-column board

The brief's main screen is a board with PROJECTS / PROJECT PLANS / NEXT ACTIONS
/ CALENDAR / WAITING / STUFF / REFERENCE / SOMEDAY / TRASH as columns. That is a
faithful reproduction of the current page, and it is the wrong default view.

A board shows you *everything you are not doing*. GTD's whole promise is the
opposite: the system holds it all so your head doesn't have to. The interface
should answer one question — **what do I do right now** — and let you go to the
board deliberately when you want the full inventory.

Keep the board. Make it `/board`, not `/`.

### 5.2 Capture (Phase 1)

A single always-available input, reachable by keyboard from anywhere in the
shell. One field. Enter saves and clears, ready for the next one. No category
picker, no date picker, no assignee — every one of those is a reason to not
capture and keep it in your head instead.

Success metric: capturing ten things in a row takes under thirty seconds.

### 5.3 Clarify (Phase 2)

Processes the inbox one item at a time, top item first, all the way to zero, per
the cheat sheet. Never a list view — a single item, full screen, with the
decision tree:

```
Is it actionable?
├── No  → Trash / Reference / Someday-Maybe
└── Yes → Will it take under 2 minutes?
          ├── Yes → do it now, mark done (writes to the ledger)
          └── No  → Is it more than one step?
                    ├── Yes → becomes a Project: ask for outcome, then first next action
                    └── No  → Is it yours to do?
                              ├── No  → Waiting: who, since when, follow-up date
                              └── Yes → Next Action: context, energy, estimate,
                                        then time-fixed? → Calendar, else the list
```

Two rules from the cheat sheet to enforce in code:
- an item can never go back to the Inbox; and
- the next action must be a *physical* action ("Call X", "Draft the email"), not
  a topic. Nudge on titles that are bare nouns.

### 5.4 Engage — the home screen (Phase 4)

This is the highest-value screen in the whole plan, and it does not appear in
the brief's twenty-four points at all, though the cheat sheet devotes a section
to it.

```
What can I do right now?

  Where am I     [@computer] [@phone] [@office] [@errands] [anywhere]
  Time I have    [<5m] [<15m] [<30m] [<1h] [as long as it takes]
  Energy         [low] [medium] [high]

  -> the filtered list of next actions, deferred items hidden,
     shortest-first, points nowhere in the sort
```

Above it, the two things that are genuinely time-bound and cannot wait:
today's calendar (fixed commitments only) and anything overdue or due today.

### 5.5 Weekly Review (Phase 6)

A guided three-step flow, not a dashboard, following the cheat sheet's own
structure — Get Clear, Get Current, Get Creative. Each step blocks on its own
completion, records a `review_sessions` row, and lands on a summary of what
changed. Get Current walks Projects **one at a time** and refuses to advance a
project with no open next action, offering to add one on the spot. That single
gate is the mechanism that keeps the projects list honest.

---

## 6. Where drag-and-drop belongs

`@dnd-kit` is already installed and the board already reorders tasks. But
free dragging between every list actively undermines this system: dragging an
inbox item straight into Next Actions bypasses Clarify, which means it arrives
without an outcome, a context, or a physical next step — the exact failure the
cheat sheet warns turns your list back into "an unappealing pile of stuff."

Allowed by drag:
- reordering within a list (already built);
- Next Action ↔ Someday (a pure commitment decision, no new fields needed);
- anything → Trash.

Everything else goes through Clarify. Dropping an inbox item on another column
should *open the clarify flow pre-answered*, not silently move the row.

---

## 7. Horizons above Goals (Phase 7)

Add a `horizons` table for Vision (3–5 yr) and Purpose & Principles, sitting
above the existing `goals`. Small, mostly prose, rarely edited — and read during
the review rather than day to day. The chain then runs end to end:

```
Purpose  →  Vision  →  Goal  →  Pillar/Function  →  Project  →  Next Action
 (new)      (new)     (have)      (have)           (rename)      (have)
```

Worth building only after the review exists, because horizons that are never
reviewed are decoration.

---

## 8. Habits are not projects (Phase 8)

Correct instinct in the brief. "Drink water daily" and "exercise daily" are not
open loops — they never close, so they can never leave a list, and they'll clog
Next Actions permanently.

`Task.is_recurring` exists but only marks a task; it doesn't generate or streak.
Build habits as their own small subsystem (`habits` + `habit_entries`, one row
per day per habit) with a streak view. It should not touch the ledger — a daily
streak feeding the leaderboard would let someone out-earn real work by drinking
water.

---

## 9. Phasing

Reordered from the brief, because its Phases 1–3 are largely already built.

| Phase | Ships | Depends on | Status |
|---|---|---|---|
| **0** | Decide §2's four conflicts. Design only. | — | done — see §2 |
| **1** | Capture: `inbox_items`, the capture bar, `capture.write` permission | 0 | **shipped** |
| **2** | Clarify: the decision tree, inbox → bucket routing | 1 | **shipped** |
| **3** | The distinct buckets: Waiting, Someday, Reference, Calendar | 2 | **shipped except Calendar** (blocked on Q4) |
| **4** | **Engage**: contexts, energy, estimates, the home screen | 3 | next, and unblocked |
| **5** | Projects: rename Milestone, natural planning model page | 3 | blocked on Q3 |
| **6** | Weekly Review | 4, 5 | |
| **7** | Horizons: Vision, Purpose | 6 | |
| **8** | Habits, then notifications | 4 | |
| **9** | Anything AI-flavoured | 6 | |

### What shipping 1–3 changed about the plan

Two things are worth recording, because they were decided while building rather
than while planning:

**The actionable branches reuse `admin.tasks` instead of a new permission.**
§2.4 left open how points and GTD coexist. Building Clarify forced the issue:
`tasks.complete` already lets anyone complete their own task and mint its
points, so task *creation* being admin-gated is the only thing standing between
a member and arbitrary points. A `clarify.to_action` grant handed out by default
would have opened exactly that hole. So the `next_action` and `project` branches
answer to the grants that already guard scored work, and the other four branches
— which create nothing anybody else can see — need only `capture.write`. This
defers Q2 rather than pre-empting it.

**Phase 3 turned out not to depend on Q1 or Q3 at all.** Someday, Reference and
Waiting are private per-owner under either answer to "single-user or team", and
none of them touches `Milestone`. Only Calendar is genuinely blocked, on Q4.

Phases 1 and 2 alone make the app usable as a GTD system. Phase 4 is what makes
it better than a notebook. Everything from 7 on is optional polish — ship it
only if 1–6 are being used daily, because a weekly review nobody runs makes
Vision pages pointless.

Do not start Phase 9. The brief lists AI clarification and auto project
detection last, which is right, and the temptation will be to pull it forward.
Clarifying is where the thinking happens; automating it removes the only step
that makes the system trustworthy.

---

## 10. Constraints in this repo that will bite

Relevant because this plan adds roughly ten tables.

1. **SQLite DDL is not transactional under Alembic.** A migration that fails
   halfway leaves its earlier `CREATE TABLE`s behind. Guard each object
   separately and make each migration re-runnable; do not batch ten new tables
   into one revision.
2. **Migrations run at import time** (`run_migrations()` in
   [backend/app/main.py](../backend/app/main.py#L14)). A bad revision doesn't
   fail a request — it kills uvicorn at startup, which reads as "Failed to
   fetch" in the browser.
3. **The export registry needs updating per new table**, and per §2.2 must
   exclude the private buckets. Treat this as part of each phase, not a cleanup
   pass.
4. **The permission catalogue is code, not migration** — new keys go in
   [permissions.py](../backend/app/modules/auth/permissions.py). Add
   `capture.write` to `DEFAULT_NEW_USER_PERMISSIONS`, and backfill existing
   accounts, or nobody can capture.
5. **`Category` is globally unique by name.** Contexts and tags must be
   per-user from the start; retrofitting ownership later is far more painful.

---

## 11. Open questions for you

1. **Single-user or team?** This plan assumes the existing multi-user model with
   private buckets (§2.2). If MyUniverse is only ever yours, a lot of §2 gets
   simpler — but the leaderboard and Company Focus stop making sense.
2. **Does the leaderboard survive?** GTD and gamification pull against each
   other (§2.4). Keeping both is coherent, but the Engage view must stay
   points-blind or the system quietly starts optimising for score.
3. **Rename `Milestone` → `Project`, or keep both?** §4 argues for the rename.
   It's a one-way door once data exists.
4. **Calendar: own table, or integrate?** Building a calendar is a real project.
   Reading from Google Calendar instead would be less work and more accurate,
   but adds an OAuth dependency.
