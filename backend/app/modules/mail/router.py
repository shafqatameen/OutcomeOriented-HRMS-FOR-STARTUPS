"""Mail diagnostics.

Sending is not a feature of this module - it is `core.mail.send_email`, called
from wherever the mail belongs. What lives here is the pair of endpoints an
administrator needs to answer "is mail actually working?" without reading the
server's logs: one that reports the configuration, one that proves it.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.mail import MailError, config_summary, mail_configured, send_email
from app.modules.auth.dependencies import require_permission
from app.modules.mail import schemas

router = APIRouter(prefix="/mail", tags=["Mail"])


@router.get("/status", response_model=schemas.MailStatus)
def mail_status(_admin=Depends(require_permission("admin.mail"))):
    """Current SMTP settings, minus the password."""
    return config_summary()


@router.post("/test", response_model=schemas.TestMailResult)
def send_test_mail(
    payload: schemas.TestMailRequest,
    admin=Depends(require_permission("admin.mail")),
):
    """Sends one diagnostic message, synchronously.

    Synchronous on purpose, unlike real transactional mail: the entire point is
    to surface the failure, so a background task that swallowed the error into a
    log would defeat the endpoint. core.mail's timeout bounds how long this can
    block.

    Defaults to the caller's own address rather than accepting an arbitrary one
    silently - an open "send mail to anyone" endpoint, even behind an admin
    permission, is a spam relay waiting to be misused.
    """
    if not mail_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Mail is not configured. Set MAIL_HOST, MAIL_USERNAME and MAIL_PASSWORD "
                "in the backend environment and restart the API."
            ),
        )

    to = (payload.to or "").strip() or (admin.email or "")
    if not to:
        raise HTTPException(
            status_code=400,
            detail="No recipient. Pass one, or set an email address on your own account first.",
        )

    try:
        send_email(
            to=to,
            subject="Test message from OutcomeOriented",
            body=(
                "This is a test message.\n\n"
                "If you are reading it, the backend can authenticate to your mail "
                "server and send through it.\n"
            ),
        )
    except MailError as exc:
        # 502: the failure is upstream at the mail provider, not in this request.
        raise HTTPException(status_code=502, detail=str(exc))

    return {"sent": True, "to": to, "detail": f"Test message sent to {to}."}
