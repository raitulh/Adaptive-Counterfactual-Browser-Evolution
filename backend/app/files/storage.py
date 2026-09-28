"""Object storage abstraction.

Object keys are always *server generated* (``tenants/{tenant_id}/files/{file_id}``);
user-supplied filenames are display metadata only and never reach a path.
Every backend still validates keys defensively (no traversal, no absolute
paths, no backslashes/NUL/control characters).

* ``LocalFilesystemStorage`` – development backend. Atomic writes (temp file +
  ``os.replace``), all disk IO off the event loop, HMAC-signed download links
  served by ``GET /files/download``.
* ``S3Storage`` – S3 / MinIO via boto3 (run in worker threads), presigned GET
  URLs that force ``Content-Disposition: attachment``.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import os
import re
import tempfile
import time
import unicodedata
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import IO, Any, Protocol
from urllib.parse import quote

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    Forbidden,
    IntegrationError,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
    NotFound,
    ValidationFailed,
)
from app.core.security import constant_time_equals, hmac_sign

MAX_KEY_LENGTH = 1024
_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]*$")
_TOKEN_VERSION = 1
_MAX_TOKEN_LENGTH = 4096
_READ_CHUNK = 64 * 1024


class UnsafeObjectKey(ValidationFailed):
    code = "invalid_object_key"
    message = "The object key is not allowed."


class ObjectNotFound(NotFound):
    code = "object_not_found"
    message = "The stored object was not found."


class ObjectStorage(Protocol):
    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get_bytes(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...

    async def signed_download_url(self, key: str, *, filename: str, ttl_seconds: int) -> str: ...


# ---------------------------------------------------------------------------- keys & names
def object_key_for(tenant_id: uuid.UUID, file_id: uuid.UUID) -> str:
    return f"tenants/{tenant_id}/files/{file_id}"


def tenant_prefix(tenant_id: uuid.UUID) -> str:
    return f"tenants/{tenant_id}/files/"


def tenant_id_from_key(key: str) -> uuid.UUID:
    """Parse the owning tenant out of a server-generated key (``tenants/{tenant}/files/{id}``)."""
    validate_key(key)
    parts = key.split("/")
    if len(parts) != 4 or parts[0] != "tenants" or parts[2] != "files":
        raise UnsafeObjectKey("Unexpected object key layout")
    try:
        return uuid.UUID(parts[1])
    except ValueError as exc:
        raise UnsafeObjectKey("Unexpected object key layout") from exc


def validate_key(key: str) -> str:
    """Reject anything that could escape the storage namespace."""
    if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
        raise UnsafeObjectKey("Object key is empty or too long")
    if "\x00" in key or "\\" in key or ".." in key:
        raise UnsafeObjectKey("Object key contains forbidden sequences")
    if key.startswith("/") or key.startswith("~") or re.match(r"^[A-Za-z]:", key):
        raise UnsafeObjectKey("Absolute object keys are not allowed")
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in key):
        raise UnsafeObjectKey("Object key contains control characters")
    if not _KEY_RE.match(key):
        raise UnsafeObjectKey("Object key contains unsupported characters")
    segments = key.split("/")
    if any(seg in ("", ".") for seg in segments):
        raise UnsafeObjectKey("Object key contains empty or relative segments")
    return key


_FILENAME_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
_WINDOWS_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                     *(f"lpt{i}" for i in range(1, 10))}


def sanitize_filename(name: str | None, *, default: str = "file", max_length: int = 200) -> str:
    """Display-safe filename. Never used to build a filesystem path or object key."""
    if not name:
        return default
    name = unicodedata.normalize("NFC", str(name))
    name = re.split(r"[/\\]", name)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch) not in ("Cc", "Cf", "Cs", "Co"))
    name = _FILENAME_FORBIDDEN.sub("_", name)
    name = re.sub(r"\s+", " ", name).strip().lstrip(".").strip()
    if not name or name in (".", ".."):
        return default
    stem, dot, ext = name.rpartition(".")
    if dot and stem and len(ext) <= 16:
        if stem.lower() in _WINDOWS_RESERVED:
            stem = "_" + stem
        stem = stem[: max(1, max_length - len(ext) - 1)]
        name = f"{stem}.{ext}"
    else:
        if name.lower() in _WINDOWS_RESERVED:
            name = "_" + name
        name = name[:max_length]
    return name


def content_disposition(filename: str) -> str:
    """RFC 6266 attachment header with an ASCII fallback and an RFC 5987 UTF-8 name."""
    safe = sanitize_filename(filename)
    ascii_name = unicodedata.normalize("NFKD", safe).encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r'["\\;]', "_", ascii_name).strip() or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe, safe='')}"


# ---------------------------------------------------------------------------- download tokens
def _download_signing_key(settings: Settings) -> str:
    # Derived (not raw) JWT secret: a leaked download signature never helps forge access tokens.
    return hmac_sign(settings.jwt_secret.get_secret_value(), "agentos:files:download-url:v1")


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_download_token(key: str, *, filename: str, ttl_seconds: int, settings: Settings | None = None,
                          now: float | None = None) -> str:
    settings = settings or get_settings()
    validate_key(key)
    expires = int((now if now is not None else time.time()) + max(1, ttl_seconds))
    payload = _b64encode(json.dumps({"v": _TOKEN_VERSION, "k": key, "e": expires,
                                     "f": sanitize_filename(filename)}, separators=(",", ":")).encode())
    signature = hmac_sign(_download_signing_key(settings), payload)
    return f"{payload}.{signature}"


def verify_download_token(token: str, *, settings: Settings | None = None, now: float | None = None
                          ) -> tuple[str, str]:
    """Return ``(key, filename)`` for a valid, unexpired token; raise ``Forbidden`` otherwise."""
    settings = settings or get_settings()
    invalid = Forbidden("The download link is invalid.", code="invalid_download_token")
    if not token or len(token) > _MAX_TOKEN_LENGTH or token.count(".") != 1:
        raise invalid
    payload, signature = token.split(".", 1)
    expected = hmac_sign(_download_signing_key(settings), payload)
    if not constant_time_equals(signature, expected):
        raise invalid
    try:
        data = json.loads(_b64decode(payload))
        key, expires, filename = str(data["k"]), int(data["e"]), str(data["f"])
        version = int(data["v"])
    except (ValueError, KeyError, TypeError, binascii.Error) as exc:
        raise invalid from exc
    if version != _TOKEN_VERSION:
        raise invalid
    if expires < (now if now is not None else time.time()):
        raise Forbidden("The download link has expired.", code="download_token_expired")
    try:
        validate_key(key)
    except UnsafeObjectKey as exc:
        raise invalid from exc
    return key, sanitize_filename(filename)


# ---------------------------------------------------------------------------- local filesystem
def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp_name)
        raise
    with contextlib.suppress(OSError):
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)


def _read_file(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except (FileNotFoundError, IsADirectoryError, NotADirectoryError) as exc:
        raise ObjectNotFound() from exc


def _unlink(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError, NotADirectoryError):
        path.unlink()


def _open_read(path: Path) -> IO[bytes]:
    try:
        return path.open("rb")
    except (FileNotFoundError, IsADirectoryError, NotADirectoryError) as exc:
        raise ObjectNotFound() from exc


class LocalFilesystemStorage:
    backend = "local"

    def __init__(self, root: str | os.PathLike[str], *, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        root_path = Path(root).expanduser()
        root_path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root_path.resolve()

    def path_for(self, key: str) -> Path:
        validate_key(key)
        candidate = (self.root / key).resolve()
        if candidate == self.root or not candidate.is_relative_to(self.root):
            raise UnsafeObjectKey("Object key resolves outside the storage root")
        return candidate

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(_write_atomic, self.path_for(key), data)

    async def get_bytes(self, key: str) -> bytes:
        return await asyncio.to_thread(_read_file, self.path_for(key))

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(_unlink, self.path_for(key))

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self.path_for(key).is_file)

    async def iter_bytes(self, key: str, chunk_size: int = _READ_CHUNK) -> AsyncIterator[bytes]:
        fh = await asyncio.to_thread(_open_read, self.path_for(key))
        try:
            while True:
                chunk = await asyncio.to_thread(fh.read, chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(fh.close)

    async def signed_download_url(self, key: str, *, filename: str, ttl_seconds: int) -> str:
        token = create_download_token(key, filename=filename, ttl_seconds=ttl_seconds,
                                      settings=self._settings)
        base = self._settings.public_base_url.rstrip("/")
        return f"{base}{self._settings.api_prefix}/files/download?token={quote(token, safe='')}"

    def verify_download_token(self, token: str) -> tuple[str, str]:
        return verify_download_token(token, settings=self._settings)


# ---------------------------------------------------------------------------- S3 / MinIO
def _build_s3_client(settings: Settings) -> Any:
    import boto3
    from botocore.config import Config

    config = Config(
        signature_version="s3v4",
        connect_timeout=5,
        read_timeout=60,
        retries={"max_attempts": 3, "mode": "standard"},
        s3={"addressing_style": "path" if settings.object_storage_endpoint else "auto"},
    )
    kwargs: dict[str, Any] = {"region_name": settings.object_storage_region, "config": config}
    if settings.object_storage_endpoint:
        kwargs["endpoint_url"] = settings.object_storage_endpoint
    access_key = settings.object_storage_access_key.get_secret_value()
    if access_key:
        kwargs["aws_access_key_id"] = access_key
        kwargs["aws_secret_access_key"] = settings.object_storage_secret_key.get_secret_value()
    return boto3.client("s3", **kwargs)


_S3_NOT_FOUND = {"NoSuchKey", "404", "NotFound", "NoSuchObject"}
_S3_THROTTLED = {"SlowDown", "Throttling", "ThrottlingException", "RequestLimitExceeded", "TooManyRequests"}


def _map_s3_error(exc: Exception) -> Exception:
    from botocore.exceptions import (
        BotoCoreError,
        ClientError,
        ConnectTimeoutError,
        EndpointConnectionError,
        ReadTimeoutError,
    )

    if isinstance(exc, ClientError):
        code = str(exc.response.get("Error", {}).get("Code", ""))
        status = int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0) or 0)
        if code in _S3_NOT_FOUND or status == 404:
            return ObjectNotFound()
        if code in _S3_THROTTLED or status == 429:
            return IntegrationRateLimited(provider="object_storage", status=status)
        if status >= 500:
            return IntegrationUnavailable(provider="object_storage", status=status)
        return IntegrationError("Object storage request failed", provider="object_storage",
                                details={"code": code[:60]}, status=status)
    if isinstance(exc, ConnectTimeoutError | ReadTimeoutError):
        return IntegrationTimeout(provider="object_storage")
    if isinstance(exc, EndpointConnectionError | BotoCoreError):
        return IntegrationUnavailable(provider="object_storage")
    return exc


class S3Storage:
    backend = "s3"

    def __init__(self, settings: Settings | None = None, *, client: Any | None = None,
                 bucket: str | None = None) -> None:
        self._settings = settings or get_settings()
        self.bucket = bucket or self._settings.object_storage_bucket
        self._client = client if client is not None else _build_s3_client(self._settings)

    async def _call(self, method: str, **kwargs: Any) -> Any:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            return await asyncio.to_thread(getattr(self._client, method), **kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise _map_s3_error(exc) from exc

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        validate_key(key)
        await self._call("put_object", Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    async def get_bytes(self, key: str) -> bytes:
        validate_key(key)
        response = await self._call("get_object", Bucket=self.bucket, Key=key)
        body = response["Body"]
        try:
            return bytes(await asyncio.to_thread(body.read))
        finally:
            await asyncio.to_thread(body.close)

    async def delete(self, key: str) -> None:
        validate_key(key)
        try:
            await self._call("delete_object", Bucket=self.bucket, Key=key)
        except ObjectNotFound:
            return

    async def exists(self, key: str) -> bool:
        validate_key(key)
        try:
            await self._call("head_object", Bucket=self.bucket, Key=key)
        except ObjectNotFound:
            return False
        return True

    async def signed_download_url(self, key: str, *, filename: str, ttl_seconds: int) -> str:
        validate_key(key)
        params = {
            "Bucket": self.bucket,
            "Key": key,
            "ResponseContentDisposition": content_disposition(filename),
            "ResponseContentType": "application/octet-stream",
        }
        url = await asyncio.to_thread(self._client.generate_presigned_url, "get_object", Params=params,
                                      ExpiresIn=max(1, int(ttl_seconds)))
        return str(url)


# ---------------------------------------------------------------------------- factory / singleton
def build_storage(settings: Settings | None = None) -> ObjectStorage:
    settings = settings or get_settings()
    if settings.object_storage_backend == "s3":
        return S3Storage(settings)
    return LocalFilesystemStorage(settings.local_storage_path, settings=settings)


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        _storage = build_storage(get_settings())
    return _storage


def set_storage(storage: ObjectStorage | None) -> None:
    global _storage
    _storage = storage
