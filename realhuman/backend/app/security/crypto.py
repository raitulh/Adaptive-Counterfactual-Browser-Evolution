"""Hashing, pseudonymization and at-rest encryption helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def sha256_hex(value: str) -> str:
    """Hash for high-entropy secrets (API keys, tokens, cookies) before storage."""
    return hashlib.sha256(value.encode()).hexdigest()


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


class Pseudonymizer:
    """
    Keyed hash for client identifiers (IP address, user agent, language).
    Equal inputs map to equal outputs, so sessions can be compared and counted,
    but the raw values are never stored.
    """

    def __init__(self, secret_key: str) -> None:
        self._key = _derive(secret_key, b"realhuman/pseudonymize")

    def __call__(self, value: str | None) -> str | None:
        if value is None:
            return None
        return hmac.new(self._key, value.encode(), hashlib.sha256).hexdigest()


class SecretBox:
    """Symmetric encryption for secrets the server must read back (webhook signing keys)."""

    def __init__(self, secret_key: str) -> None:
        key = _derive(secret_key, b"realhuman/secret-box")
        self._fernet = Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as error:
            raise ValueError("Secret could not be decrypted (was SECRET_KEY changed?)") from error


def _derive(secret_key: str, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(
        secret_key.encode()
    )
