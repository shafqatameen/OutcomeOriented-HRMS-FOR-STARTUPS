# OutcomeOriented

A gamified point system with a leaderboard, task board, goal tracking, per-feature
access control, and CSV/Excel data export.

## Overview

People are assigned tasks that belong to a category. Completing a task writes a row
to an append-only point ledger and adds to the person's running total, which drives
the leaderboard and the history chart. Tasks can optionally hang off a milestone,
and milestones roll up into goals, so long-running work has visible progress.

Every feature is gated by a permission key granted per account, and everything the
app stores can be exported as a spreadsheet.

## Tech Stack

### Frontend

- **Framework**: Next.js 16 (App Router) with React 19
- **Styling**: Tailwind CSS v4, shadcn/ui conventions over `@base-ui/react`
- **Drag and drop**: `@dnd-kit` for task reordering
- **Charts**: Recharts
- **Icons**: Lucide React
- **TypeScript**: throughout

### Backend

- **Framework**: FastAPI (Python 3.14+)
- **Database**: SQLite (`pointsystem.db`)
- **ORM**: SQLAlchemy 2.0
- **Migrations**: Alembic, applied automatically at startup
- **Validation**: Pydantic 2.x
- **Auth**: bcrypt hashing + PyJWT in an HttpOnly session cookie
- **Export**: openpyxl

## Architecture

```
frontend/
├── src/
│   ├── app/
│   │   ├── (gate)/          # Unauthenticated routes (login)
│   │   ├── (shell)/         # Authenticated app inside the nav shell
│   │   │   ├── page.tsx     # Leaderboard
│   │   │   ├── universe/    # MyUniverse: inbox pane, planner grid, Kanban board
│   │   │   ├── inbox/       # Capture list and the clarify flow
│   │   │   ├── someday/     # Someday / Maybe
│   │   │   ├── reference/   # Reference notes
│   │   │   ├── waiting/     # Delegated work
│   │   │   ├── tasks/       # Board, per-category views, history
│   │   │   ├── goals/       # Goal list and goal detail
│   │   │   ├── export/      # Export builder
│   │   │   └── admin/       # tasks, goals, categories, people, access
│   │   └── layout.tsx
│   ├── components/          # Shared components + ui/ primitives
│   └── lib/                 # API clients, session, access helpers
└── package.json

backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, router wiring
│   ├── core/                # base, database, migrations, daterange, integrity
│   └── modules/
│       ├── auth/            # login, session cookie, permission catalogue
│       ├── users/           # accounts, activation, access grants
│       ├── inbox/           # capture, and the clarify decision tree
│       ├── buckets/         # someday, reference and waiting lists
│       ├── boards/          # MyUniverse: boards, lists, cards, checklists, labels
│       ├── tasks/           # categories, tasks, point ledger
│       ├── goals/           # goals and milestones
│       ├── leaderboard/     # rankings and chart data
│       └── export/          # sheet registry, builders, CSV/XLSX writers
├── alembic/                 # migration versions
├── seed.py
└── requirements.txt

deploy/                      # VPS install: Caddy, systemd units, scripts
```

Server Components call the API directly over loopback (`INTERNAL_API_URL`), while
browser code uses `NEXT_PUBLIC_API_URL`.

## Features

### Capture (Inbox)

The first step of the GTD workflow this app is growing into — see
[docs/gtd-plan.md](docs/gtd-plan.md) for the full plan and its open questions.

- Press <kbd>c</kbd> anywhere in the app, or use the button at the bottom right,
  to write down an open loop. Enter saves and clears so the next one can follow
  immediately; the panel stays open until you dismiss it.
- An inbox item holds an owner, some text and a timestamp, and nothing else. No
  category, no assignee, no due date, no points — every field would be one more
  decision demanded at the moment of typing, which is how a capture step stops
  getting used. Those decisions belong to Clarify, below.
- Inbox items are **private**. No endpoint accepts a user id; you reach an inbox
  only by being its owner, and nothing captured appears on the leaderboard, the
  panel or an export.
- An item is not a task and cannot become one by editing. The only ways out are
  Clarify (below) and discarding it.
- The rail badges the unclarified count, and goes quiet at zero.

Gated on `capture.write`, which every account holds by default. Note that this
is deliberately *not* `admin.tasks`: assigning work to another person stays
privileged, but writing down your own open loop never is.

### Clarify

The guided decision tree that empties the inbox. Takes items **one at a time,
oldest first** — never a row of buttons on a list, because deciding from a list
view is how people skim for the easy item and leave the awkward ones to rot.

```
Is there anything to do about this?
├── No  → Reference · Someday/Maybe · Bin
└── Yes → Would it take under two minutes?
          ├── Yes → do it now, and the item just goes
          └── No  → More than one step?
                    ├── Yes → Project: outcome, goal, and its first action
                    └── No  → Is it yours?
                              ├── No  → Waiting on someone
                              └── Yes → Next action on the task board
```

Two rules are enforced in the API, not just the UI:

- **A project cannot be created without its first next action.** A project with
  no action does not move, and you find that out months later during a review.
- **Nothing goes back in the inbox.** The destination row and the inbox delete
  share one transaction, so a rejected clarify leaves the item exactly where it
  was rather than filing a duplicate.

The `next action` and `project` branches create scored work, so they answer to
the existing `admin.tasks` (and `admin.goals`) grants — the same gates that have
always guarded task creation. Members see those branches disabled with the
reason, and the other four remain fully available to them.

### Holding lists

The three lists an inbox item is clarified into. All private to their owner, all
gated on `lists.write`, which every account holds by default. Kept as three
tables rather than one, so each can require exactly what it means:

| List | Requires | Deliberately has no |
|---|---|---|
| **Someday / Maybe** | a title | date, context, assignee — the absence is what makes it safe to park things here |
| **Reference** | a title and a body | status of any kind; there is nothing about a wifi password to be done |
| **Waiting on** | a delegate and a start date | completion by you — it is somebody else's move |

- Someday tracks when each possibility was last reviewed, so a weekly review can
  surface the ones that have sat untouched since the day they were written.
- Waiting sorts longest-outstanding first, computes `days_waiting` server-side,
  and flags anything past its follow-up date. A delegate can be an account here
  or just a typed name, since plenty of what you wait on is owed by someone who
  will never have a login.

### MyUniverse

A Trello-shaped Kanban board at `/universe`, gated on `boards.write`. One screen,
three panes, all reading the same board:

| Pane | Shows |
|---|---|
| **Inbox** | unclarified captures from the capture bar, each with a one-click *To board*, above the board's own Inbox list |
| **Planner** | three days on an hour grid, every card that has a due date, with overlapping blocks split into lanes |
| **Board** | the lists left to right, cards drag-and-drop within and between them |

The panes are resizable: drag the divider between two of them, or focus it and
use the arrow keys (Shift for a bigger step, double-click to reset). Each pane
has a minimum width it will not go below, so a divider dragged to the end parks
its neighbour at that minimum rather than closing it. Widths are kept as
proportions of the row and remembered per account in `localStorage`, so they
survive a reload and re-divide sensibly when the window changes size.

Any pane can also be switched off from the bar along the bottom; the last one
open stays open. The Inbox list is drawn by the Inbox pane, so the board omits
that column while the pane is up — and shows it again when it is not.

Side-by-side versus one-at-a-time is decided by measuring the row rather than by
a CSS breakpoint, because the navigation rail takes 240px of the window and only
64px once collapsed. When the row cannot hold every open pane at its minimum —
a phone, a tablet, a narrow window — the same bar along the bottom becomes a set
of tabs and one pane fills the screen.

A personal board is created on the account's first read of `/boards`, named
*MyUniverse*, seeded with twelve GTD lists: Inbox, Projects, Project Plans, Next
Actions, Calendar, Waiting/Delegate, Stuff, Reference, Someday/Maybe, Trash, Needs
to Cultivate, Bank for AI Agents. That is a starting arrangement, not a structure:
every list can be renamed, reordered, archived or deleted. Seeded lists carry a
stable `role` slug (`inbox`, `calendar`, `trash`) that survives a rename, which is
what keeps the Planner pointed at the right column after somebody calls Calendar
"Diary".

- A **card** holds a title, markdown description, start and due datetimes,
  checklist, labels, comments, assignees, and where it came from (`manual`,
  `email`, `calendar_sync`, `ai_agent`).
- **Deleting** a card moves it to Trash; deleting it again is permanent. Cards
  left in Trash are purged after the board's `trash_purge_days` (30 by default,
  configurable, null to keep forever) — swept on board read, since this app runs
  no worker.
- **Ordering** is a server-owned integer column. Clients send a destination index
  ("dropped third"), never a sort key, so two people dragging at once cannot
  invent conflicting positions.
- Ticking a card's checkbox is the **board's** own done-ness. It writes no ledger
  row and awards no points — those belong to the task board, and a checkbox that
  quietly moved the leaderboard would make both numbers untrustworthy.
- **Personal boards are private**, on the same footing as the inbox: no endpoint
  takes a user id, and an Admin cannot open one either. Role is about running the
  company, and somebody's private Someday list is not company business.
- **Team boards** need `boards.team`, are blank by default (To Do / Doing / Done,
  with GTD available as an opt-in), and carry per-member roles — admin, member,
  viewer. Assignees only exist here; assigning on a personal board is refused
  rather than ignored.

### Google Calendar

Two-way sync between a personal board and one Google calendar, gated on
`calendar.sync`. Connected from the *Connect calendar* button in the MyUniverse
header.

**Per person, never per installation.** Each account authorises its own Google
account, in its own browser, and the tokens that come back are stored against
that account alone — `google_accounts.user_id` is unique, and no endpoint in the
module takes a user id. Alice sees her calendar; Bob sees his; neither can reach
the other's, and nor can an Admin. Disconnecting revokes the grant at Google as
well as deleting it here.

| Direction | What moves |
|---|---|
| **Google → board** | Events in the window become cards in the Calendar list, `source = calendar_sync`, drawn on the Planner like any other dated card |
| **Board → Google** | Every card with a due date, wherever it sits — not only the Calendar list, on the same reasoning the Planner uses |

Either direction can be switched off on its own. Recurrences arrive expanded, so
next Tuesday's stand-up can be moved without moving all the others. All-day
events fill their day. A card with no start time gets the same half hour the
Planner draws for it.

- **Conflicts are last-write-wins**, compared between Google's `updated` stamp
  and the card's `updated_at`. Both sides are editable, so the alternative is
  either blocking on a human or silently merging into a version neither side
  wrote. What changed is reported after every sync.
- **Nothing runs on a timer** — this app has no worker process. A sync happens
  when the board is opened (at most once every five minutes) or when *Sync now*
  is pressed. Google's push notifications would need a public HTTPS callback,
  which a self-hosted install may not have.
- **Deletes propagate both ways.** A cancelled event moves its card to Trash
  rather than deleting it — the card may carry notes the calendar never had. A
  card moved to Trash, stripped of its due date, or deleted outright takes its
  event with it.
- **The window is bounded** — 7 days back and 90 ahead by default, adjustable up
  to a year either side. A calendar has no ends, and a weekly recurrence would
  otherwise fill the board with years of meetings.
- **Tokens are encrypted at rest** with a key derived from `JWT_SECRET_KEY`. A
  refresh token is a live grant on somebody's calendar rather than a proof of
  anything, and this repo's own `pointsystem.backup-*.db` files are exactly the
  kind of copy that outlives the database it came from. Rotating
  `JWT_SECRET_KEY` therefore makes existing connections unreadable: they report
  themselves disconnected, and each owner reconnects in two clicks.

Setting it up needs a Google Cloud OAuth client — the steps, and the three
environment variables, are in `backend/.env.example`. Until they are set the
integration reports itself unconfigured and says so, rather than sending anybody
to a Google error page.

### Points

- Categories carry a `default_points` value; a task inherits it unless a custom
  value is pinned on the task itself. Changing a category default retroactively
  changes what its uncompleted tasks are worth (see [points.py](backend/app/modules/tasks/points.py)).
- Completing a task appends to `point_ledger` — totals are never edited in place.
- Tasks can be marked recurring.
- Timestamps are Asia/Kolkata (IST) wall-clock.

### Tasks

- Drag to reorder within a category, or move between categories
- Edit a task from the board — title, assignee, milestone, points, recurrence.
  Only the fields that changed are sent, so concurrent edits to different fields
  of the same task don't overwrite each other
- Delete a pending task, behind a confirmation naming who loses what
- Per-category views and a completion history
- Optional milestone linkage

Completion is the point of no return. A completed task can still be renamed or
relinked, but it cannot be reassigned, repriced, moved between categories, or
deleted — its points are already in the ledger under the person who earned them,
and none of those writes would move the ledger with them.

### Goals

- Goals contain milestones; milestones contain tasks
- Progress derived from milestone and task completion

### Leaderboard

- Point rankings with a per-category breakdown
- Point history chart over a selectable date range

### Access Control

Two roles (`Admin`, `Member`). Admins bypass all checks so they can't lock
themselves out. Everyone else holds explicit permission keys, defined in
[permissions.py](backend/app/modules/auth/permissions.py):

| Key | Grants |
|---|---|
| `capture.write` | Capture to your own inbox, clarify it, and discard from it |
| `lists.write` | Your own Someday/Maybe, Reference and Waiting lists |
| `boards.write` | Your own MyUniverse board — lists, cards, drag-and-drop |
| `boards.team` | Create shared boards and choose who is on them |
| `calendar.sync` | Connect your own Google Calendar to your own board |
| `leaderboard.view` | Point matrix and history chart |
| `tasks.view` | Task board and history |
| `tasks.complete` | Mark tasks done and earn points |
| `tasks.organize` | Reorder and move tasks |
| `goals.view` | Goals, milestones, progress |
| `admin.tasks` | Create and assign tasks, and edit or delete them |
| `admin.goals` | Create, rename and delete goals and milestones; complete milestones |
| `admin.categories` | Manage categories and default points |
| `admin.users` | Manage accounts and grant access |
| `data.export` | Export own data |
| `data.export.all` | Widen exports to every account |

Adding a gated feature means adding an entry to that list — no migration needed.

Accounts can be deactivated rather than deleted: the account keeps its tasks,
ledger rows and leaderboard position, but can no longer log in, and existing
sessions stop working immediately.

### Export

Ten sheets — summary, users, categories, tasks, activity log, goals, milestones,
leaderboard, daily activity, access matrix — selectable individually and filtered
by date range, category, goal, status or user. Output is a single `.xlsx` workbook,
a bare `.csv` for one sheet, or a `.zip` of CSVs with a README for several. The
catalogue lives in [registry.py](backend/app/modules/export/registry.py); adding a
sheet is one entry plus one builder.

## Running the Application

### Prerequisites

- Node.js 18+
- Python 3.14+
- SQLite (bundled with Python)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt # or: uv sync

cp .env.example .env            # then fill in JWT_SECRET_KEY
python seed.py                  # first run only; prints generated passwords once

uvicorn app.main:app --reload --port 8000
```

Alembic migrations run automatically on startup, creating the schema on a fresh
database or bringing an existing one up to head.

> `backend/main.py` is an unused stub. The application entry point is
> `app.main:app`.

#### Environment

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET_KEY` | insecure dev default | Signs session JWTs, and derives the key encrypting stored Google tokens. Set before any deployment; rotating it also drops every calendar connection. |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin, and where the Google callback returns to |
| `COOKIE_SECURE` | `false` | Adds `Secure` to the session cookie; must stay false on local http |
| `SEED_PASSWORD_*` | random | Optional fixed passwords for `seed.py` |
| `GOOGLE_CLIENT_ID` | unset | OAuth client for the calendar sync. Blank disables the feature cleanly. |
| `GOOGLE_CLIENT_SECRET` | unset | Its secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/integrations/google/callback` | Must match the Authorised redirect URI on the OAuth client character for character |

### Frontend

```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | API base for browser requests |
| `INTERNAL_API_URL` | `http://127.0.0.1:8000` | API base for Server Components |

### Deployment

[deploy/README.md](deploy/README.md) covers a single-domain Ubuntu VPS setup: Caddy
terminates HTTPS and proxies `/api/*` to FastAPI and everything else to Next.js,
both bound to loopback, each under a systemd unit. Serving both halves from one
origin keeps the session cookie first-party and removes CORS from the browser path.

## API Endpoints

### Auth
| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Email + password; sets the session cookie |
| `POST` | `/auth/logout` | |
| `GET` | `/auth/me` | Current session and granted permissions |

Sign-in is by email address. Accounts created before `users.email` existed have
none yet, and those keep signing in with their display name until an
administrator sets one from **Admin › People** — setting it switches that
account over permanently. `GET /auth/login-options` has been removed: it listed
every account to anonymous callers, which is an account-enumeration hole that
email sign-in makes unnecessary.

### Mail
| Method | Path | Notes |
|---|---|---|
| `GET` | `/mail/status` | SMTP settings in use, minus the password (`admin.mail`) |
| `POST` | `/mail/test` | Sends a diagnostic message (`admin.mail`) |

Mail is configured entirely through environment variables (`MAIL_HOST`,
`MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`) — see
`backend/.env.example`. Leave `MAIL_HOST` blank and nothing is dialled out:
every send is printed to the backend log instead, which is the intended local
development setting.

### Users and Access
| Method | Path |
|---|---|
| `GET` / `POST` | `/users` |
| `PATCH` | `/users/{id}` |
| `PATCH` | `/users/{id}/active` |
| `DELETE` | `/users/{id}` |
| `GET` | `/users/access` |
| `GET` | `/users/access/catalogue` |
| `PUT` | `/users/{id}/access` |

### Inbox
Always scoped to the caller — none of these take a user id.

| Method | Path |
|---|---|
| `GET` / `POST` | `/inbox` |
| `GET` | `/inbox/count` |
| `POST` | `/inbox/{id}/clarify` |
| `DELETE` | `/inbox/{id}` |

### Holding lists
Also always scoped to the caller.

| Method | Path |
|---|---|
| `GET` / `POST` | `/someday` |
| `PATCH` / `DELETE` | `/someday/{id}` |
| `GET` / `POST` | `/reference` |
| `PATCH` / `DELETE` | `/reference/{id}` |
| `GET` / `POST` | `/waiting` |
| `PATCH` / `DELETE` | `/waiting/{id}` |

### MyUniverse
Boards are resolved through ownership or membership, never from the id alone; a
board you cannot see answers 404 rather than 403.

| Method | Path |
|---|---|
| `GET` / `POST` | `/boards` |
| `GET` | `/boards/mine` |
| `GET` / `PATCH` / `DELETE` | `/boards/{id}` |
| `PUT` | `/boards/{id}/members` |
| `DELETE` | `/boards/{id}/members/{user_id}` |
| `POST` | `/boards/{id}/lists` |
| `PATCH` | `/boards/{id}/lists/reorder` |
| `POST` | `/boards/{id}/labels` |
| `GET` | `/boards/{id}/calendar?start=&end=` |
| `PATCH` / `DELETE` | `/lists/{id}` |
| `POST` | `/lists/{id}/cards` |
| `GET` / `PATCH` / `DELETE` | `/cards/{id}` |
| `PATCH` | `/cards/{id}/move` |
| `POST` | `/cards/{id}/checklist` |
| `POST` | `/cards/{id}/comments` |
| `PATCH` / `DELETE` | `/checklist/{id}` |
| `PATCH` / `DELETE` | `/labels/{id}` |
| `DELETE` | `/comments/{id}` |

Lists, cards and their parts sit at the root rather than under `/boards`, because
`/boards/cards/5` and `/boards/{board_id}` are the same shape to a router and
whichever is declared first wins. A card knows its list and a list knows its
board, so none of them needs a board id in the path.

### Google Calendar
Every route resolves the connection from the caller's own session. None takes a
user id, so there is nowhere to put one.

| Method | Path |
|---|---|
| `GET` | `/integrations/google/status` |
| `GET` | `/integrations/google/authorize` |
| `GET` | `/integrations/google/callback` |
| `GET` | `/integrations/google/calendars` |
| `PATCH` | `/integrations/google/settings` |
| `POST` | `/integrations/google/sync` |
| `DELETE` | `/integrations/google/connection` |

`/callback` is the only endpoint here that answers with a redirect rather than
JSON, because Google sends a browser to it — a failure has to come back as a
page somebody is looking at. It checks both the signed `state` and the session
cookie, and requires them to name the same account: a state check alone would
still let a crafted link attach an attacker's calendar to somebody else's board.

### Tasks and Categories
| Method | Path |
|---|---|
| `GET` / `POST` | `/categories` |
| `PATCH` | `/categories/{id}` |
| `GET` | `/categories/{id}/usage` |
| `DELETE` | `/categories/{id}` |
| `GET` / `POST` | `/tasks` |
| `PATCH` | `/tasks/reorder` |
| `PATCH` / `DELETE` | `/tasks/{id}` |
| `PATCH` | `/tasks/{id}/move` |
| `POST` | `/tasks/{id}/complete` |

### Goals
| Method | Path |
|---|---|
| `GET` / `POST` | `/goals` |
| `PATCH` / `DELETE` | `/goals/{id}` |
| `GET` | `/goals/{id}/usage` |
| `GET` / `POST` | `/milestones` |
| `PATCH` / `DELETE` | `/milestones/{id}` |
| `GET` | `/milestones/{id}/usage` |

### Leaderboard and Export
| Method | Path |
|---|---|
| `GET` | `/leaderboard` |
| `GET` | `/chart-data` |
| `GET` | `/export/manifest` |
| `GET` | `/export` |

Interactive docs are at `http://localhost:8000/docs` while the backend is running.

## Development

### Design system

[frontend/DESIGN.md](frontend/DESIGN.md) is the source of truth for the visual
language — a dense, utilitarian YC/HN-style palette with one accent color, sharp
corners and no decoration. Read it before adding UI.

> Next.js 16 has breaking changes from earlier versions. Check
> `frontend/node_modules/next/dist/docs/` before writing framework code.

### Backend conventions

1. One module per feature under `app/modules/`, each with its own router, models
   and schemas
2. SQLAlchemy models registered through `app/core/base.py`
3. Pydantic schemas for all request and response bodies
4. Schema changes go through an Alembic revision
5. Gate endpoints with `require_permission("some.key")`

### Testing

There are no automated tests. Changes should be manually exercised across login,
task completion, admin forms and an export download.

## Known Gaps

- **No automated test suite.**
- **Google Calendar sync has no push channel.** It is built and two-way (see
  above), but it polls: nothing runs on a timer in this app, so a sync happens
  on board open or on demand. Google's push notifications need a public HTTPS
  callback Google can reach, which a self-hosted install behind aaPanel may not
  have — and a channel has to be renewed on a schedule there is no worker to run.
- **The calendar sync assumes IST.** Board times are IST wall-clock throughout,
  matching the rest of the app, so events are converted into IST on the way in
  and stamped `Asia/Kolkata` on the way out. An account working in another
  timezone would see its own events at the wrong hour — fixing that means a
  per-user timezone, which nothing in this app has yet.
- **No real-time updates on team boards.** Two people on one board see each
  other's changes on the next read, not as they happen.
- **Card attachments are not implemented** — a description can hold links, but
  there is no attachment model or upload.
- **Dark theme is unreachable** — `.dark` tokens exist in `globals.css` but nothing
  applies the class and there is no toggle.
- `backend/main.py` is a leftover stub.
- `backend/README.md` is empty and `frontend/README.md` is still create-next-app
  boilerplate.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Test manually across the affected surfaces
5. Submit a pull request

## Support

For issues and support, please open an issue in the repository.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Shafqat Ameen and
contributors.

<!-- CI/CD deploy test: 2026-08-13 -->

