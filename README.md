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
| `JWT_SECRET_KEY` | insecure dev default | Signs session JWTs. Set before any deployment. |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `COOKIE_SECURE` | `false` | Adds `Secure` to the session cookie; must stay false on local http |
| `SEED_PASSWORD_*` | random | Optional fixed passwords for `seed.py` |

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
| `GET` | `/auth/login-options` | Public; id/name of accounts that can log in |
| `POST` | `/auth/login` | Sets the session cookie |
| `POST` | `/auth/logout` | |
| `GET` | `/auth/me` | Current session and granted permissions |

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

