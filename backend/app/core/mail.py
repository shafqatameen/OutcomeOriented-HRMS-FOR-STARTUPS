"""Outbound mail, over plain SMTP.

Deliberately stdlib-only (`smtplib` + `email`): the volume here is auth
transactional mail - a handful of messages a day - so a queue, a broker or a
third-party SDK would be machinery with nothing to do. Adding one later means
replacing `send_email` and nothing else, because that is the only entry point.

Configuration is read once at import from the environment, the same way
JWT_SECRET_KEY and COOKIE_SECURE already are. On the server those come from
systemd's EnvironmentFile (/etc/hrms/backend.env, mode 640); nothing is ever
read from a file this process could accidentally serve.
"""
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

MAIL_HOST = os.environ.get("MAIL_HOST", "").strip()
MAIL_PORT = int(os.environ.get("MAIL_PORT", "587") or 587)
MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "").strip()
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "OutcomeOriented").strip()

#: Defaults to the login, which is what most providers require anyway - many
#: reject a MAIL FROM that is not the authenticated mailbox.
MAIL_FROM = os.environ.get("MAIL_FROM", "").strip() or MAIL_USERNAME

#: Seconds. Without this smtplib inherits the global socket default, which is
#: "wait forever" - one unreachable mail host would then pin a worker thread
#: until the request times out somewhere further up.
MAIL_TIMEOUT = int(os.environ.get("MAIL_TIMEOUT", "15") or 15)

#: Escape hatch for local development: leave MAIL_HOST unset and every send is
#: printed to the log instead of dialled out. Nothing silently disappears, and
#: no developer needs the production mailbox password to work on a flow.
MAIL_ENABLED = bool(MAIL_HOST)


class MailError(RuntimeError):
    """A send that did not happen, with a reason safe to show an administrator.

    Carries no credentials: smtplib puts the username in some of its exception
    strings, so the messages raised here are written rather than passed through.
    """


def mail_configured() -> bool:
    return MAIL_ENABLED and bool(MAIL_FROM)


def config_summary() -> dict:
    """Non-secret view of the current settings, for the admin diagnostics page.

    The password is reported as a boolean and never as a value or a length -
    a length is a real hint to anyone who gets hold of this response.
    """
    return {
        "configured": mail_configured(),
        "host": MAIL_HOST or None,
        "port": MAIL_PORT,
        "username": MAIL_USERNAME or None,
        "from_address": MAIL_FROM or None,
        "from_name": MAIL_FROM_NAME,
        "has_password": bool(MAIL_PASSWORD),
        "security": _security_mode(),
    }


def _security_mode() -> str:
    """465 is implicit TLS, 587 is STARTTLS. Overridable for odd hosts.

    Never returns "none" by accident: an operator who wants an unencrypted
    session has to ask for it by setting MAIL_SECURITY explicitly, because the
    password is sent in the clear on a plain connection.
    """
    explicit = os.environ.get("MAIL_SECURITY", "").strip().lower()
    if explicit in {"ssl", "starttls", "none"}:
        return explicit
    return "ssl" if MAIL_PORT == 465 else "starttls"


def _normalise_recipient(address: str) -> str:
    """Rejects header injection before it reaches the SMTP conversation.

    A newline in an address is how a caller-supplied value turns into extra
    headers (a second Bcc, say). EmailMessage guards its own setters, but the
    address is also used for the envelope, so it is checked here as well.
    """
    address = (address or "").strip()
    if not address or any(c in address for c in "\r\n"):
        raise MailError("Invalid recipient address.")
    if "@" not in parseaddr(address)[1]:
        raise MailError(f"Not an email address: {address}")
    return address


def send_email(to: str, subject: str, body: str, html: str | None = None) -> None:
    """Sends one message, raising MailError if it could not be delivered to the
    relay. Returns None on success.

    "Delivered to the relay" is the strongest promise SMTP can make here: the
    provider accepting the message says nothing about the recipient's inbox.
    Callers that need more than that need bounce handling, which this does not
    have.
    """
    to = _normalise_recipient(to)

    if any(c in subject for c in "\r\n"):
        raise MailError("Subject cannot contain line breaks.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((MAIL_FROM_NAME, MAIL_FROM)) if MAIL_FROM_NAME else MAIL_FROM
    message["To"] = to
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")

    if not MAIL_ENABLED:
        # Not an error: this is the documented local-development path.
        print(f"[mail:disabled] would send to {to}: {subject}\n{body}")
        return

    if not MAIL_FROM:
        raise MailError(
            "No sender address. Set MAIL_FROM (or MAIL_USERNAME) in the backend environment."
        )

    _deliver(message, to)


def _deliver(message: EmailMessage, to: str) -> None:
    mode = _security_mode()
    context = ssl.create_default_context()

    try:
        if mode == "ssl":
            server = smtplib.SMTP_SSL(MAIL_HOST, MAIL_PORT, timeout=MAIL_TIMEOUT, context=context)
        else:
            server = smtplib.SMTP(MAIL_HOST, MAIL_PORT, timeout=MAIL_TIMEOUT)

        with server:
            server.ehlo()
            if mode == "starttls":
                server.starttls(context=context)
                # Required by RFC 3207: the pre-TLS EHLO response is unauthenticated
                # and must be discarded, or a stripped AUTH list would go unnoticed.
                server.ehlo()
            if MAIL_USERNAME:
                server.login(MAIL_USERNAME, MAIL_PASSWORD)
            server.send_message(message, from_addr=MAIL_FROM, to_addrs=[to])

    # Each of these is re-raised with a written message rather than the original:
    # smtplib embeds the username in several of its exception strings, and this
    # text is shown to an administrator in the UI.
    except smtplib.SMTPAuthenticationError:
        raise MailError(
            "The mail server rejected the username or password. "
            "Check MAIL_USERNAME and MAIL_PASSWORD."
        ) from None
    except smtplib.SMTPRecipientsRefused:
        raise MailError(f"The mail server refused the recipient {to}.") from None
    except smtplib.SMTPSenderRefused:
        raise MailError(
            f"The mail server refused the sender {MAIL_FROM}. "
            "Most providers require it to match the authenticated mailbox."
        ) from None
    except ssl.SSLError:
        raise MailError(
            f"TLS failed against {MAIL_HOST}:{MAIL_PORT}. "
            "Port 587 expects STARTTLS and 465 expects implicit TLS - "
            "set MAIL_SECURITY if this server disagrees."
        ) from None
    except (smtplib.SMTPException, OSError) as exc:
        # OSError covers connection refused, DNS failure and the socket timeout.
        raise MailError(f"Could not reach {MAIL_HOST}:{MAIL_PORT} ({type(exc).__name__}).") from None
