"""What counts as an acceptable password, in one place.

Two rules, and deliberately only two.

A **minimum of 12 characters**, with no composition requirements at all - no
"one capital, one digit, one symbol". Those rules are actively
counterproductive: they rule out most long passphrases while permitting
`King@123`, so people converge on a short word with a capital at the front and a
digit at the back, which is the first thing any cracking wordlist tries. Length
is the property that actually costs an attacker anything.

A **maximum of 72 bytes**, which is not a policy choice but bcrypt's hard limit.
Bcrypt 5 raises on anything longer, so without this check a long passphrase is a
500 from the API rather than a sentence the person can act on. Bytes, not
characters: a password of emoji or Devanagari reaches 72 bytes in far fewer
keystrokes than an ASCII one, and counting characters would let those through to
the same crash.
"""

MIN_LENGTH = 12

#: bcrypt's own limit. Passwords are measured as UTF-8 bytes because that is
#: what bcrypt hashes.
MAX_BYTES = 72


class WeakPassword(ValueError):
    """Raised with a sentence suitable for showing to whoever typed it."""


def validate(password: str, confirmation: str | None = None) -> str:
    """Returns the password if it is acceptable, else raises WeakPassword.

    The confirmation is checked here, on the server, even though the browser
    checks it too. A mismatched confirmation that only the browser catches means
    anyone posting directly to the API can set a password they mistyped and then
    be unable to sign in with either version.

    Not stripped or otherwise normalised: leading and trailing spaces are part
    of the password. Trimming them would mean the value that was set and the
    value that was typed next time could differ by whatever a paste happened to
    include.
    """
    password = password or ""

    if confirmation is not None and password != confirmation:
        raise WeakPassword("The two passwords do not match.")

    if len(password) < MIN_LENGTH:
        raise WeakPassword(f"Use at least {MIN_LENGTH} characters.")

    if len(password.encode("utf-8")) > MAX_BYTES:
        raise WeakPassword(
            f"That is too long to store safely - keep it under {MAX_BYTES} bytes "
            "(about 72 plain characters, fewer if you use emoji or accents)."
        )

    return password
