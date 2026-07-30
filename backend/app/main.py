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
