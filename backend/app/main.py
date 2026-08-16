import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.migrations import run_migrations

from app.modules.users.router import router as users_router
from app.modules.tasks.router import router as tasks_router
from app.modules.goals.router import router as goals_router
from app.modules.leaderboard.router import router as leaderboard_router
from app.modules.auth.router import router as auth_router
from app.modules.export.router import router as export_router
from app.modules.org.router import router as org_router
from app.modules.panel.router import router as panel_router
from app.modules.mail.router import router as mail_router
from app.modules.inbox.router import router as inbox_router
from app.modules.inbox.clarify import router as clarify_router
from app.modules.buckets.router import router as buckets_router
from app.modules.boards.router import router as boards_router
from app.modules.boards.router import elements_router as board_elements_router
from app.modules.calendar_sync.router import router as google_calendar_router

# Applies Alembic migrations up to head - creates all tables on a fresh
# database, or brings an existing one up to date. Model imports (and thus
# Base.metadata registration) happen inside alembic/env.py itself.
run_migrations()

app = FastAPI(title="Gamified Point System API - Modular Monolith")

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Downloads are cross-origin (3000 -> 8000), and the browser hides every
    # response header from JS unless it is named here. Without this the export
    # page cannot read the filename the API chose.
    expose_headers=["Content-Disposition"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(tasks_router)
app.include_router(goals_router)
app.include_router(leaderboard_router)
app.include_router(export_router)
app.include_router(org_router)
app.include_router(panel_router)
app.include_router(mail_router)
app.include_router(inbox_router)
app.include_router(clarify_router)
app.include_router(buckets_router)
# Literal paths first: /cards/{id} and friends live on their own router precisely
# so they can never be swallowed by /boards/{board_id}. See boards/router.py.
app.include_router(board_elements_router)
app.include_router(boards_router)
app.include_router(google_calendar_router)
