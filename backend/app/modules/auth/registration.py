"""Self-service accounts: signing up, confirming an address, resetting a password.

Everything here is reachable without a session, which shapes all of it.

**No endpoint may reveal whether an address has an account.** `/signup`,
`/forgot-password` and `/resend-verification` therefore return the same body and
the same status whether the address is unknown, registered, pending, verified or
deactivated. That is not politeness - a sign-up form that answers "already
registered" is a membership oracle, and for a company tool the membership list is
the staff list.

**No link may be usable twice**, and the spending of it is committed in the same
transaction as the password it authorises. See tokens.py.

**Mail goes out after the response is decided**, through BackgroundTasks, so a
slow SMTP handshake cannot hold the request open - and so the timing of the
response does not depend on whether there was anything to send, which would leak
exactly what the identical bodies are hiding.
"""
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.database import SessionLocal, get_db
from app.core.emails import InvalidEmail, normalise_email
from app.core.mail import MailError, mail_configured
from app.modules.auth import notifications, schemas, tokens
from app.modules.auth.dependencies import COOKIE_NAME
from app.modules.auth.models import PURPOSE_PASSWORD_RESET, PURPOSE_VERIFY_EMAIL
from app.modules.auth.passwords import WeakPassword, validate as validate_password
from app.modules.auth.security import create_access_token, hash_password
from app.modules.tasks.models import get_ist_now
from app.modules.users import models as user_models

router = APIRouter(prefix="/auth", tags=["Auth"])

COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # seconds, 7 days
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def signup_enabled() -> bool:
    """Whether strangers may create accounts at all.

    Defaults to on, matching the deployment this was built for, but exists so an
    installation can close the door without deploying different code - and so
    the endpoint can be turned off in a hurry if it is ever being abused.
    """
    return os.environ.get("PUBLIC_SIGNUP_ENABLED", "true").strip().lower() != "false"


#: Deliberately vague, and identical for every outcome. Whoever really owns the
#: address learns what happened from the mail; whoever does not, learns nothing.
GENERIC_SENT = (
    "If that address can be used here, we have sent it a link. "
    "Check the inbox, and the spam folder."
)


# --- Rate limits --------------------------------------------------------------
#
# Two keys per request, both required to pass. The address bounds how much mail
# one mailbox can be made to receive; the IP bounds how fast one caller can walk
# through a list of addresses. Either alone leaves the other attack open.

MAIL_PER_ADDRESS = (3, 3600.0)   # 3 an hour to any one address
MAIL_PER_IP = (10, 3600.0)       # 10 an hour from any one caller
ATTEMPTS_PER_IP = (30, 600.0)    # token submissions, 30 per 10 minutes


def _client_key(request: Request) -> str:
    """Best available identifier for the caller.

    `request.client.host` is the socket peer, which behind the nginx of
    deploy/install.sh is the proxy itself - so in production this collapses to
    one bucket for everybody until the proxy's forwarded header is trusted
    explicitly. Reading X-Forwarded-For here without that configuration would be
    worse than useless: it is caller-supplied, so anyone could mint a fresh
    identity per request and the limit would stop existing.
    """
    return request.client.host if request.client else "unknown"


def _guard(request: Request, per_ip, address: str = "", per_address=None) -> None:
    """Counts this request against the limits. 429 if either is exhausted.

    Both counters are always incremented, never short-circuited: `and` on the
    right-hand side of an already-failed check would let one limit shield the
    other from ever being counted.
    """
    ip_ok = ratelimit.check(f"auth:ip:{_client_key(request)}", *per_ip)

    address_ok = True
    if address and per_address:
        address_ok = ratelimit.check(f"auth:addr:{address}", *per_address)

    if not (ip_ok and address_ok):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Wait a few minutes and try again.",
        )


# --- Helpers ------------------------------------------------------------------

def _unique_name(db: Session, preferred: str) -> str:
    """A display name nobody else holds.

    users.name is unique and is still a sign-in identifier for accounts with no
    address (see router.find_account), so a collision is not a cosmetic problem -
    it is an integrity error at best and an ambiguous login at worst. Suffixing
    is crude but predictable, and the person can rename themselves later.
    """
    base = (preferred or "").strip() or "Member"
    candidate = base
    suffix = 2
    while db.query(user_models.User.id).filter(
        func.lower(user_models.User.name) == candidate.lower()
    ).first():
        candidate = f"{base} {suffix}"
        suffix += 1
    return candidate


def _mask(address: str) -> str:
    """`sam@example.com` -> `s••@example.com`.

    Shown on the set-password page so somebody with two addresses can tell which
    one this link belongs to. Masked rather than printed in full because the
    link may be opened on a shared screen, and the URL alone should not disclose
    the whole address to whoever is looking over the shoulder.
    """
    local, _, domain = (address or "").partition("@")
    if not domain:
        return "•••"
    head = local[:1] or "•"
    return f"{head}{'•' * max(len(local) - 1, 2)}@{domain}"


def _send(task: BackgroundTasks, fn, *args) -> None:
    """Queues one message, with failures logged rather than raised.

    A background task that raises would put a stack trace in the log and change
    nothing for the caller, who has already had their response. Catching it here
    keeps the log line short and says which address failed, which is the only
    thing anyone can act on.
    """

    def run():
        try:
            fn(*args)
        except MailError as exc:
            print(f"[mail:failed] {fn.__name__} -> {args[0] if args else '?'}: {exc}")

    task.add_task(run)


def _notify_admins(task: BackgroundTasks, pending: user_models.User) -> None:
    """Tells every admin with an address that somebody is waiting.

    Opens its own session inside the task rather than borrowing the request's:
    by the time a background task runs, FastAPI has already closed the dependency
    session, and reading from it would fail on a detached instance.
    """
    pending_name = pending.name
    pending_email = pending.email or ""

    def run():
        db = SessionLocal()
        try:
            admins = (
                db.query(user_models.User)
                .filter(user_models.User.role == "Admin")
                .filter(user_models.User.is_active.is_(True))
                .filter(user_models.User.email.isnot(None))
                .all()
            )
            if not admins:
                # Not an error, and worth a line: on this installation the seed
                # accounts have no addresses yet, so approvals have to be noticed
                # on the People page until one is set.
                print(
                    f"[signup] {pending_name} <{pending_email}> is awaiting approval, "
                    "but no admin has an email address set."
                )
                return
            for admin in admins:
                try:
                    notifications.send_pending_notice(
                        admin.email, admin.name, pending_name, pending_email
                    )
                except MailError as exc:
                    print(f"[mail:failed] pending notice -> {admin.email}: {exc}")
        finally:
            db.close()

    task.add_task(run)


# --- Signing up ---------------------------------------------------------------

@router.post("/signup", response_model=schemas.GenericMessage)
def signup(
    payload: schemas.SignupRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Starts an account. Never says whether one already existed.

    No password is taken here, on purpose. The address is proven first and the
    password is chosen on the page the mailed link opens, so a password is only
    ever stored for a mailbox somebody has demonstrated they can read. It also
    means a stranger cannot set a password on an address that is not theirs.
    """
    if not signup_enabled():
        raise HTTPException(
            status_code=403,
            detail="This site is not accepting new accounts. Ask an administrator for one.",
        )

    try:
        email = normalise_email(payload.email)
    except InvalidEmail as exc:
        # The one thing worth answering honestly: a malformed address is the
        # typist's own text, and tells nobody anything about who is registered.
        raise HTTPException(status_code=400, detail=str(exc))

    _guard(request, MAIL_PER_IP, email, MAIL_PER_ADDRESS)

    if not mail_configured():
        # Refused rather than half-done: creating the row and failing to send
        # would leave an account nobody can ever finish, and the next attempt
        # would look to the person like the address was taken.
        raise HTTPException(
            status_code=503,
            detail="Sign-up is unavailable because this server cannot send mail yet.",
        )

    existing = (
        db.query(user_models.User).filter(user_models.User.email == email).first()
    )

    if existing is None:
        user = user_models.User(
            name=_unique_name(db, payload.name or email.partition("@")[0]),
            email=email,
            role="Member",
            total_points=0,
            password_hash=None,
            # Inactive and unapproved: confirming the address gets them into the
            # queue, not into the app. An administrator is still the only way in.
            is_active=False,
            approved_at=None,
            email_verified_at=None,
        )
        db.add(user)
        db.flush()  # assigns user.id, which the token needs
        raw = tokens.issue(db, user.id, PURPOSE_VERIFY_EMAIL)
        db.commit()
        _send(background, notifications.send_verification, email, user.name, raw)

    elif existing.email_verified_at is None:
        # A second attempt on an address that never finished. Re-sending is the
        # helpful thing, and it is safe: the mail only ever goes to the address
        # itself, so nobody learns anything by triggering it.
        raw = tokens.issue(db, existing.id, PURPOSE_VERIFY_EMAIL)
        db.commit()
        _send(background, notifications.send_verification, email, existing.name, raw)

    else:
        # Already a real account. Silence here would be a dead end for someone
        # who simply forgot they had signed up, so they get a reset link instead -
        # which is useful to the owner and useless to anyone else.
        raw = tokens.issue(db, existing.id, PURPOSE_PASSWORD_RESET)
        db.commit()
        _send(background, notifications.send_password_reset, email, existing.name, raw)

    return {"message": GENERIC_SENT}


@router.post("/resend-verification", response_model=schemas.GenericMessage)
def resend_verification(
    payload: schemas.EmailRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Another confirmation link, for the one that never arrived."""
    try:
        email = normalise_email(payload.email)
    except InvalidEmail:
        # Not echoed back here, unlike signup: this endpoint is reached from a
        # state where the address is already known-good, so a rejection would
        # only ever be a probe.
        return {"message": GENERIC_SENT}

    _guard(request, MAIL_PER_IP, email, MAIL_PER_ADDRESS)

    user = db.query(user_models.User).filter(user_models.User.email == email).first()
    if user is not None and user.email_verified_at is None and mail_configured():
        raw = tokens.issue(db, user.id, PURPOSE_VERIFY_EMAIL)
        db.commit()
        _send(background, notifications.send_verification, email, user.name, raw)

    return {"message": GENERIC_SENT}


# --- Following a link ---------------------------------------------------------

@router.post("/token/check", response_model=schemas.TokenCheck)
def check_token(payload: schemas.TokenCheckRequest, db: Session = Depends(get_db)):
    """Is this link still good? Answered without spending it.

    Separate from the endpoints that use the token because mail scanners and
    corporate link-rewriters fetch URLs before any human sees them. If merely
    opening the page consumed the link, the people best protected by their IT
    department would be the ones who could never finish signing up.
    """
    if payload.purpose not in {PURPOSE_VERIFY_EMAIL, PURPOSE_PASSWORD_RESET}:
        raise HTTPException(status_code=400, detail="Unknown link type.")

    token = tokens.look_up(db, payload.token, payload.purpose)
    if token is None:
        return {"valid": False, "email": None, "name": None}

    user = token.user
    return {"valid": True, "email": _mask(user.email or ""), "name": user.name}


@router.post("/verify", response_model=schemas.VerifyResult)
def verify(
    payload: schemas.SetPasswordRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Confirms the address and sets the first password, in one transaction.

    Both halves or neither. A commit that stored the password but left the
    address unconfirmed would produce an account that can never sign in and can
    never be re-verified, because the link is gone.
    """
    _guard(request, ATTEMPTS_PER_IP)

    try:
        password = validate_password(payload.password, payload.password_confirm)
    except WeakPassword as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token = tokens.consume(db, payload.token, PURPOSE_VERIFY_EMAIL)
    if token is None:
        raise HTTPException(
            status_code=400,
            detail="This link has expired or has already been used. Ask for a new one.",
        )

    now = get_ist_now()
    user = token.user
    user.password_hash = hash_password(password)
    user.email_verified_at = now
    db.commit()

    if user.approved_at is None:
        _notify_admins(background, user)
        return {
            "status": "pending",
            "message": (
                "Your address is confirmed and your password is set. "
                "An administrator has to approve the account before you can sign in."
            ),
        }

    # Pre-approved - an administrator created the account and it is only the
    # password that was missing. Nothing left to wait for.
    return {
        "status": "ready",
        "message": "Your password is set. You can sign in now.",
    }


# --- Forgotten passwords ------------------------------------------------------

@router.post("/forgot-password", response_model=schemas.GenericMessage)
def forgot_password(
    payload: schemas.EmailRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Mails a reset link, if there is anywhere to mail it.

    Deactivated accounts get nothing. Letting someone who has been removed reset
    their way back to a working password would make deactivation a suggestion,
    and the identical response means they cannot tell that from a typo.
    """
    try:
        email = normalise_email(payload.email)
    except InvalidEmail:
        return {"message": GENERIC_SENT}

    _guard(request, MAIL_PER_IP, email, MAIL_PER_ADDRESS)

    user = db.query(user_models.User).filter(user_models.User.email == email).first()

    if user is not None and user.is_active and mail_configured():
        raw = tokens.issue(db, user.id, PURPOSE_PASSWORD_RESET)
        db.commit()
        _send(background, notifications.send_password_reset, email, user.name, raw)

    return {"message": GENERIC_SENT}


@router.post("/reset-password", response_model=schemas.VerifyResult)
def reset_password(
    payload: schemas.SetPasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Sets a new password and, when the account is usable, signs them straight in.

    Signing in here is not a shortcut taken for convenience. Whoever followed
    this link has just proved control of the mailbox and chosen the password, so
    immediately asking them to type it again proves nothing and is where people
    fumble the password they set ten seconds ago.
    """
    _guard(request, ATTEMPTS_PER_IP)

    try:
        password = validate_password(payload.password, payload.password_confirm)
    except WeakPassword as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token = tokens.consume(db, payload.token, PURPOSE_PASSWORD_RESET)
    if token is None:
        raise HTTPException(
            status_code=400,
            detail="This link has expired or has already been used. Ask for a new one.",
        )

    now = get_ist_now()
    user = token.user
    user.password_hash = hash_password(password)

    # Proving the mailbox proves the address, so an account that reached here
    # without being verified - one an admin created and never mailed - is
    # verified now.
    if user.email_verified_at is None:
        user.email_verified_at = now

    # Every other outstanding link for this account dies with this one. If the
    # mailbox was briefly readable by someone else, a second live reset link
    # sitting in it would undo everything this endpoint just did.
    tokens.invalidate(db, user.id, None, now)
    db.commit()

    if user.approved_at is None:
        return {
            "status": "pending",
            "message": "Your password is set. An administrator still has to approve this account.",
        }
    if not user.is_active:
        return {
            "status": "deactivated",
            "message": "Your password is set, but this account is deactivated. Ask an administrator.",
        }

    session_token = create_access_token(user.id, user.name, user.role)
    response.set_cookie(
        key=COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return {"status": "signed_in", "message": "Your password is set. You are signed in."}


@router.get("/signup-status", response_model=schemas.SignupStatus)
def signup_status():
    """What the sign-up page should offer, asked before it renders.

    Both flags matter to the page: with mail unconfigured the form cannot work at
    all, and showing it anyway means people fill it in and get a 503 for their
    trouble.
    """
    return {"enabled": signup_enabled(), "mail_ready": mail_configured()}
