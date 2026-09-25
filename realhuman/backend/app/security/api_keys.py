"""Secret API keys (`rh_test_sk_…` / `rh_live_sk_…`) and public site keys."""

from __future__ import annotations

import re
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApiKey
from app.security.crypto import sha256_hex

_PREFIX = re.compile(r"^([a-z]+(?:_[a-z]+)*_)", re.IGNORECASE)


def generate_secret_key(environment: str) -> str:
    return f"rh_{environment}_sk_{secrets.token_hex(24)}"


def generate_site_key() -> str:
    return f"pk_live_{secrets.token_hex(12)}"


def mask_secret(secret: str, visible: int = 4) -> str:
    """Same masking as the frontend: `rh_test_sk_9f8e…3f2e` → `rh_test_sk_••••••••3f2e`."""
    match = _PREFIX.match(secret)
    prefix = match.group(1) if match else ""
    body = secret[len(prefix) :]
    if len(body) <= visible:
        return f"{prefix}{'•' * 8}"
    return f"{prefix}{'•' * 8}{body[-visible:]}"


def find_active_key(db: Session, secret: str) -> ApiKey | None:
    key = db.scalar(select(ApiKey).where(ApiKey.key_hash == sha256_hex(secret)))
    if key is None or key.revoked_at is not None:
        return None
    return key
