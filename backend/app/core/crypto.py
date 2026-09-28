"""Encryption of sensitive credentials at rest (OAuth tokens, MCP/API secrets).

``KeyManager`` is the KMS abstraction. The local implementation uses Fernet
(AES-128-CBC + HMAC-SHA256) with MultiFernet for key rotation: the first key
encrypts, all keys decrypt, and ``rotate`` re-encrypts under the primary.
Cloud KMS implementations (envelope encryption with a KMS-wrapped data key)
plug in behind the same interface without touching callers.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import Settings, get_settings
from app.core.exceptions import ConfigurationMissing


class DecryptionError(RuntimeError):
    pass


class KeyManager(Protocol):
    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, ciphertext: str) -> str: ...

    def rotate(self, ciphertext: str) -> str: ...


class LocalFernetKeyManager:
    def __init__(self, keys: list[bytes]) -> None:
        if not keys:
            raise ConfigurationMissing("TOKEN_ENCRYPTION_KEY is not configured")
        self._fernet = MultiFernet([Fernet(k) for k in keys])

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise DecryptionError("credential could not be decrypted with any configured key") from exc

    def rotate(self, ciphertext: str) -> str:
        try:
            return self._fernet.rotate(ciphertext.encode("ascii")).decode("ascii")
        except InvalidToken as exc:
            raise DecryptionError("credential could not be decrypted with any configured key") from exc


def build_key_manager(settings: Settings) -> KeyManager:
    if settings.kms_provider == "local":
        return LocalFernetKeyManager(settings.encryption_keys())
    # Cloud KMS providers are deployment integrations: they wrap a per-record data key
    # with the KMS key (envelope encryption). They are selected by configuration and must
    # be provided by the deployment package; refusing to start is safer than silently
    # falling back to a weaker scheme.
    raise ConfigurationMissing(f"KMS provider '{settings.kms_provider}' is not installed in this build")


@lru_cache(maxsize=1)
def get_key_manager() -> KeyManager:
    return build_key_manager(get_settings())
