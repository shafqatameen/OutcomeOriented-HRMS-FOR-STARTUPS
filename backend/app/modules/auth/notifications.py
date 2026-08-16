"""The mail this module sends, and the links inside it.

Kept apart from the endpoints so that changing what a message says never means
touching what an endpoint does. Every function here builds and sends one
message; none of them decide whether it should be sent.

Two rules hold across all of them:

  * Links point at the *frontend*, never the API. The backend serves JSON and
    has no page to land on, and a token in a link the browser follows must end
    up somewhere a person can type a password.

  * A send failure is logged and swallowed by the caller, never surfaced. Whether
    mail left the building is not something an unauthenticated caller may learn,
    because "that address bounced" and "that address is registered" are the same
    fact stated twice.
"""
import os
from html import escape
from urllib.parse import quote

from app.core.mail import send_email

#: Where the links land. The same origin CORS already trusts, so there is one
#: place to change when the app moves rather than two that can disagree.
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")

APP_NAME = os.environ.get("MAIL_FROM_NAME", "OutcomeOriented")


def _link(path: str, token: str) -> str:
    """A frontend URL carrying `token` as a query parameter.

    Quoted with an empty safe list: `token_urlsafe` output needs no escaping
    today, but a link that silently breaks if the alphabet ever changes is a
    bad thing to leave lying around.
    """
    return f"{FRONTEND_ORIGIN}{path}?token={quote(token, safe='')}"


def _wrap(heading: str, paragraphs: list, button_label: str, url: str) -> str:
    """Minimal HTML with the link also written out in full.

    Inline styles, tables avoided, no images, no external CSS: mail clients strip
    stylesheets and block remote content, so anything clever here degrades to
    unstyled text at best. The bare URL below the button is not redundant - a
    button is unclickable in a plain-text client and untrustworthy in a
    suspicious one, and people paste the address instead.
    """
    body = "".join(
        f'<p style="margin:0 0 16px;line-height:1.6;color:#1f2937;">{escape(text)}</p>'
        for text in paragraphs
    )
    safe_url = escape(url, quote=True)
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;\
max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="margin:0 0 20px;font-size:20px;color:#111827;">{escape(heading)}</h1>
  {body}
  <p style="margin:24px 0;">
    <a href="{safe_url}" style="background:#2563eb;color:#ffffff;text-decoration:none;\
padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600;">{escape(button_label)}</a>
  </p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">\
Or paste this address into your browser:</p>
  <p style="margin:0 0 24px;color:#6b7280;font-size:13px;word-break:break-all;">{safe_url}</p>
  <p style="margin:0;color:#9ca3af;font-size:12px;">{escape(APP_NAME)}</p>
</div>"""


def send_verification(to: str, name: str, token: str) -> None:
    """"Confirm your address, then choose a password." One mail, one link."""
    url = _link("/verify", token)
    greeting = f"Hi {name}," if name else "Hi,"
    paragraphs = [
        greeting,
        f"Someone asked to create an {APP_NAME} account with this address. "
        "Confirm it and choose a password using the link below.",
        "The link works for 24 hours. If this was not you, ignore this message - "
        "no account can be used until the link is followed.",
    ]
    send_email(
        to=to,
        subject=f"Confirm your {APP_NAME} address",
        body="\n\n".join(paragraphs + [url]),
        html=_wrap("Confirm your address", paragraphs, "Confirm and set password", url),
    )


def send_password_reset(to: str, name: str, token: str) -> None:
    url = _link("/reset-password", token)
    greeting = f"Hi {name}," if name else "Hi,"
    paragraphs = [
        greeting,
        f"Someone asked to reset the password for your {APP_NAME} account. "
        "Choose a new one using the link below.",
        "The link works for one hour and can be used once. If this was not you, "
        "ignore this message - your current password still works and nothing has changed.",
    ]
    send_email(
        to=to,
        subject=f"Reset your {APP_NAME} password",
        body="\n\n".join(paragraphs + [url]),
        html=_wrap("Reset your password", paragraphs, "Choose a new password", url),
    )


def send_approved(to: str, name: str) -> None:
    """Sent when an administrator lets a pending account in.

    Worth sending rather than leaving people to guess: an account waiting for
    approval looks identical to one that was rejected, and without this the only
    way to find out is to keep trying to sign in.
    """
    url = f"{FRONTEND_ORIGIN}/login"
    greeting = f"Hi {name}," if name else "Hi,"
    paragraphs = [
        greeting,
        f"Your {APP_NAME} account has been approved. You can sign in now.",
    ]
    send_email(
        to=to,
        subject=f"Your {APP_NAME} account is ready",
        body="\n\n".join(paragraphs + [url]),
        html=_wrap("Your account is ready", paragraphs, "Sign in", url),
    )


def send_pending_notice(to: str, name: str, pending_name: str, pending_email: str) -> None:
    """Tells an administrator that somebody is waiting.

    Without it, approval depends on an admin happening to open the People page,
    and a new colleague sits blocked for however long that takes.
    """
    url = f"{FRONTEND_ORIGIN}/admin/people"
    greeting = f"Hi {name}," if name else "Hi,"
    paragraphs = [
        greeting,
        f"{pending_name} ({pending_email}) has confirmed their address and is "
        f"waiting for approval to join {APP_NAME}.",
        "They cannot sign in until someone approves them.",
    ]
    send_email(
        to=to,
        subject=f"{pending_name} is waiting for approval",
        body="\n\n".join(paragraphs + [url]),
        html=_wrap("Someone is waiting for approval", paragraphs, "Review pending accounts", url),
    )
