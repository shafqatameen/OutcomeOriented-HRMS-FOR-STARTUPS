import os
import secrets
import string

from app.core.database import SessionLocal
from app.core.emails import normalise_email
from app.core.migrations import run_migrations
from app.modules.users.models import User
from app.modules.tasks.models import Category
from app.modules.goals import models as goals_models
# Task.function and User.home_function are declared by string, so the org models
# have to be registered before SQLAlchemy configures any mapper here.
from app.modules.org import models as org_models  # noqa: F401
from app.modules.auth.security import hash_password

SEED_USERS = [("Abdu", "Admin"), ("Annu", "Member"), ("Sam", "Member")]

#: The track axis: what a task does for you, and what it is therefore worth.
#: Drain is not here because migration a1c4e07f52bd adds it to every database,
#: new and existing alike.
SEED_CATEGORIES = [("Adjacent", 2), ("Core", 3)]


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


def resolve_emails() -> dict:
    """Sign-in addresses from SEED_EMAIL_<NAME> env vars. Unset means unset.

    No address is invented for an account that has none: a made-up one would be
    a sign-in identifier that cannot receive mail, which is worse than the
    legacy name fallback it would be replacing. Accounts left without one are
    named in the summary below so somebody can fill them in from the admin page.
    """
    emails = {}
    for name, _role in SEED_USERS:
        raw = os.environ.get(f"SEED_EMAIL_{name.upper()}", "").strip()
        if raw:
            emails[name] = normalise_email(raw)
    return emails


def seed_db():
    run_migrations()
    db = SessionLocal()
    passwords = resolve_passwords()
    emails = resolve_emails()
    issued = {}

    if db.query(User).count() == 0:
        print("Seeding Users...")
        db.add_all([
            User(
                name=name,
                role=role,
                email=emails.get(name),
                password_hash=hash_password(passwords[name]),
            )
            for name, role in SEED_USERS
        ])
        db.commit()
        issued = dict(passwords)
    else:
        changed = False
        for user in db.query(User).all():
            if not user.password_hash and user.name in passwords:
                user.password_hash = hash_password(passwords[user.name])
                issued[user.name] = passwords[user.name]
                changed = True

            # Only ever fills a gap. An address already set was set deliberately -
            # from the admin page, most likely - and re-running the seed script
            # must not quietly move somebody's sign-in identifier back to
            # whatever the environment happens to say today.
            if not user.email and user.name in emails:
                user.email = emails[user.name]
                changed = True

        if changed:
            db.commit()
            print("Backfilled sign-in details for existing users (points/tasks untouched).")

    # Checked name by name rather than on an empty table: migration a1c4e07f52bd
    # seeds the Drain track, so by the time this runs the table is never empty
    # and a count-based guard would skip Adjacent and Core on every fresh install.
    existing_categories = {name for (name,) in db.query(Category.name).all()}
    missing_categories = [
        Category(name=name, default_points=points)
        for name, points in SEED_CATEGORIES
        if name not in existing_categories
    ]
    if missing_categories:
        print("Seeding Categories...")
        db.add_all(missing_categories)
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

    without_email = [
        user.name for user in db.query(User).order_by(User.name).all() if not user.email
    ]
    if without_email:
        print(
            "\nStill signing in by name, because they have no address yet:\n"
            f"  {', '.join(without_email)}\n"
            "Set one from Admin > Accounts (or via SEED_EMAIL_<NAME>) to move them\n"
            "onto email sign-in. Each account switches over the moment it gets one."
        )

    db.close()


if __name__ == "__main__":
    seed_db()
