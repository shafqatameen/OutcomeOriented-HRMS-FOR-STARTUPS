from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def run_migrations() -> None:
    """Applies all pending Alembic migrations (idempotent - a no-op once the
    database is already at head). Replaces the old hand-rolled ALTER TABLE
    patching that used to live here."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
