import os
import secrets
import string

from app.core.database import SessionLocal
from app.core.migrations import run_migrations
from app.modules.users.models import User
from app.modules.tasks.models import Category
from app.modules.goals import models as goals_models
from app.modules.auth.security import hash_password

SEED_USERS = [("Abdu", "Admin"), ("Annu", "Member"), ("Sam", "Member")]


def _generate_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


def resolve_passwords() -> dict:
    """Seed passwords come from SEED_PASSWORD_<NAME> env vars (see .env.example).
    Anything unset gets a random password, printed once below - so no working
    credential is ever hardcoded in the repository."""
    passwords = {}
    for name, _role in SEED_USERS:
        env_key = f"SEED_PASSWORD_{name.upper()}"
        passwords[name] = os.environ.get(env_key) or _generate_password()
    return passwords


def seed_db():
    run_migrations()
    db = SessionLocal()
    passwords = resolve_passwords()
    issued = {}

    if db.query(User).count() == 0:
        print("Seeding Users...")
        db.add_all([
            User(name=name, role=role, password_hash=hash_password(passwords[name]))
            for name, role in SEED_USERS
        ])
        db.commit()
        issued = dict(passwords)
    else:
        for user in db.query(User).all():
            if not user.password_hash and user.name in passwords:
                user.password_hash = hash_password(passwords[user.name])
                issued[user.name] = passwords[user.name]
        if issued:
            db.commit()
            print("Backfilled password_hash for existing users (points/tasks untouched).")

    if db.query(Category).count() == 0:
        print("Seeding Categories...")
        db.add_all([
            Category(name="Adjacent", default_points=2),
            Category(name="Core", default_points=3)
        ])
        db.commit()

    if db.query(goals_models.Goal).count() == 0:
        print("Seeding Goals...")
        goal = goals_models.Goal(title="Renovate the Living Room")
        db.add(goal)
        db.commit()
        db.refresh(goal)
        db.add_all([
            goals_models.Milestone(title="Clear Out Old Furniture", goal_id=goal.id),
            goals_models.Milestone(title="Paint Walls", goal_id=goal.id),
        ])
        db.commit()

    if issued:
        print("\nSeed complete. Credentials for the accounts just created:")
        for name, pw in issued.items():
            print(f"  {name}: {pw}")
        print("\nRandomly generated where SEED_PASSWORD_<NAME> was not set.")
        print("Save these now - they are not stored anywhere in plaintext.")
    else:
        print("Seed complete. No new accounts; existing passwords left untouched.")

    db.close()


if __name__ == "__main__":
    seed_db()
