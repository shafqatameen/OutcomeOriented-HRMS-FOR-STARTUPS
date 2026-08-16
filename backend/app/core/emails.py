"""The email address as an identity value.

Separate from core.mail, which is about transport: this module decides what a
stored address looks like, so that "is this the same account?" has one answer.
Nothing here opens a socket.

Validation is deliberately conservative rather than exhaustive. A regex that
accepts exactly the addresses RFC 5322 allows is famously enormous and still
does not tell you whether the mailbox exists, so the checks below only reject
what would break something concrete downstream - an empty local part, a missing
or dotless domain, whitespace, or the line breaks that turn a stored value into
injected mail headers later. Anything past that is the mail server's call.
"""


class InvalidEmail(ValueError):
    """Raised with a sentence suitable for showing to whoever typed the address."""


def normalise_email(raw: str) -> str:
    """Returns the address as it should be stored, or raises InvalidEmail.

    Lowercased in full, including the local part. That is technically stricter
    than the standard - `Sam@x.com` and `sam@x.com` are permitted to be
    different mailboxes - but no real provider treats them as different, and
    folding them is what lets a plain unique index stop one person registering
    the same address twice with different capitalisation.
    """
    address = (raw or "").strip()

    if not address:
        raise InvalidEmail("Email cannot be empty.")

    # Checked before anything else: a line break here is what would let a stored
    # address inject headers into a message built from it later.
    if any(character in address for character in "\r\n\t"):
        raise InvalidEmail("Email cannot contain line breaks or tabs.")

    if " " in address:
        raise InvalidEmail("Email cannot contain spaces.")

    # rsplit, not split: the local part is allowed to contain a quoted @.
    local, separator, domain = address.rpartition("@")
    if not separator or not local or not domain:
        raise InvalidEmail(f"'{address}' is not an email address.")

    if "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise InvalidEmail(f"'{address}' does not have a valid domain.")

    if ".." in domain:
        raise InvalidEmail(f"'{address}' does not have a valid domain.")

    return address.lower()
