import os
import secrets
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

if SECRET_KEY == "dev-insecure-secret-change-me":
    print("WARNING: JWT_SECRET_KEY not set - using an insecure dev default. "
          "Set the JWT_SECRET_KEY environment variable before any real deployment.")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


#: A real bcrypt hash of a value nobody knows, for login to check against when
#: the account does not exist. Its only job is to cost the same as a genuine
#: verification, so an unknown address and a wrong password take the same time.
#:
#: Generated at import rather than hardcoded: a literal in the source would be a
#: fixed target, and this costs one hash once per process start.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def create_access_token(user_id: int, name: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "name": name, "role": role, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str):
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
