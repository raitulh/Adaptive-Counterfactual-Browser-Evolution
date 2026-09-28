"""Stable, time-ordered identifiers.

UUIDv7 (RFC 9562) gives globally unique, roughly time-ordered keys: they
index well in B-trees (append-mostly), are safe to generate on any node
without coordination, and remain valid UUIDs for PostgreSQL's ``uuid`` type.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid


def uuid7() -> uuid.UUID:
    unix_ms = time.time_ns() // 1_000_000
    rand_a = secrets.randbits(12)
    rand_b = secrets.randbits(62)
    value = (unix_ms & 0xFFFF_FFFF_FFFF) << 80
    value |= 0x7 << 76
    value |= rand_a << 64
    value |= 0b10 << 62
    value |= rand_b
    return uuid.UUID(int=value)


def new_id() -> uuid.UUID:
    return uuid7()


def short_token(nbytes: int = 32) -> str:
    """URL-safe random token (for refresh tokens, OAuth state, nonces)."""
    return secrets.token_urlsafe(nbytes)


def stable_hash(*parts: object) -> str:
    """Deterministic SHA-256 over ordered parts; used for idempotency keys."""
    digest = hashlib.sha256()
    for part in parts:
        digest.update(str(part).encode("utf-8"))
        digest.update(b"\x1f")
    return digest.hexdigest()


def worker_identity() -> str:
    return f"{os.uname().nodename}:{os.getpid()}:{secrets.token_hex(3)}"
