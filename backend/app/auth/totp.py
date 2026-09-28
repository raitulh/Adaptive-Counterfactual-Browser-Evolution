"""RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — the MFA factor behind the MFA-ready design."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10**DIGITS)
    return str(code).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) // STEP_SECONDS)


def code_at(secret_b32: str, step: int) -> str:
    return _hotp(secret_b32, step)


def verify(secret_b32: str, code: str, *, last_used_step: int | None = None, window: int = 1,
           now: float | None = None) -> int | None:
    """Return the matched time step, or None. Steps <= last_used_step are rejected (replay)."""
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != DIGITS:
        return None
    step = current_step(now)
    for candidate in range(step - window, step + window + 1):
        if last_used_step is not None and candidate <= last_used_step:
            continue
        if hmac.compare_digest(_hotp(secret_b32, candidate), code):
            return candidate
    return None


def provisioning_uri(secret_b32: str, account: str, issuer: str) -> str:
    return (f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret_b32}&issuer={quote(issuer)}"
            f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}")
