"""Object storage: key safety, local atomic storage, signed download tokens, S3 adapter."""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.exceptions import (
    Forbidden,
    IntegrationError,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
)
from app.files.storage import (
    LocalFilesystemStorage,
    ObjectNotFound,
    S3Storage,
    UnsafeObjectKey,
    _map_s3_error,
    build_storage,
    content_disposition,
    create_download_token,
    object_key_for,
    sanitize_filename,
    tenant_id_from_key,
    validate_key,
    verify_download_token,
)

TENANT = uuid.UUID("0190a1b2-0000-7000-8000-000000000001")
KEY = object_key_for(TENANT, uuid.UUID("0190a1b2-0000-7000-8000-0000000000aa"))


# ---------------------------------------------------------------------------- keys
@pytest.mark.parametrize("key", [
    "../etc/passwd", "tenants/../../etc/passwd", "tenants/a/..", "/etc/passwd", "tenants\\x\\y", "a\x00b",
    "C:/windows/system32", "~/.ssh/id_rsa", "", "a//b", "./a", "a/./b", "tenants/x/\n", "x" * 2000,
    "tenants/a b", "a/%2e%2e/b", ".hidden",
])
def test_unsafe_keys_rejected(key: str) -> None:
    with pytest.raises(UnsafeObjectKey):
        validate_key(key)


def test_server_generated_keys_are_valid_and_parse_tenant() -> None:
    assert validate_key(KEY) == KEY
    assert tenant_id_from_key(KEY) == TENANT
    with pytest.raises(UnsafeObjectKey):
        tenant_id_from_key("tenants/not-a-uuid/files/x")
    with pytest.raises(UnsafeObjectKey):
        tenant_id_from_key("other/layout")


# ---------------------------------------------------------------------------- local storage
async def test_local_roundtrip_atomic_and_idempotent_delete(tmp_path: Path) -> None:
    storage = LocalFilesystemStorage(tmp_path / "objects")
    await storage.put_bytes(KEY, b"hello", "text/plain")
    assert await storage.exists(KEY)
    assert await storage.get_bytes(KEY) == b"hello"
    await storage.put_bytes(KEY, b"replaced", "text/plain")
    assert await storage.get_bytes(KEY) == b"replaced"
    path = storage.path_for(KEY)
    assert oct(path.stat().st_mode & 0o777) == oct(0o600)
    assert not [p for p in path.parent.iterdir() if p.name.startswith(".tmp-")]
    chunks = [c async for c in storage.iter_bytes(KEY, chunk_size=3)]
    assert b"".join(chunks) == b"replaced"
    await storage.delete(KEY)
    await storage.delete(KEY)  # idempotent
    assert not await storage.exists(KEY)
    with pytest.raises(ObjectNotFound):
        await storage.get_bytes(KEY)


async def test_local_rejects_traversal_and_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "objects"
    outside = tmp_path / "outside"
    outside.mkdir()
    storage = LocalFilesystemStorage(root)
    for bad in ("../outside/x", "/etc/passwd", "tenants\\..\\x"):
        with pytest.raises(UnsafeObjectKey):
            await storage.put_bytes(bad, b"x", "text/plain")
        with pytest.raises(UnsafeObjectKey):
            await storage.get_bytes(bad)
    os.symlink(outside, root / "tenants")
    with pytest.raises(UnsafeObjectKey):
        await storage.put_bytes(KEY, b"x", "text/plain")
    assert list(outside.iterdir()) == []


# ---------------------------------------------------------------------------- signed tokens
async def test_signed_url_format_and_verification(tmp_path: Path) -> None:
    settings = get_settings()
    storage = LocalFilesystemStorage(tmp_path, settings=settings)
    url = await storage.signed_download_url(KEY, filename="report.pdf", ttl_seconds=60)
    prefix = f"{settings.public_base_url.rstrip('/')}{settings.api_prefix}/files/download?token="
    assert url.startswith(prefix)
    token = parse_qs(urlsplit(url).query)["token"][0]
    assert storage.verify_download_token(token) == (KEY, "report.pdf")
    assert verify_download_token(token) == (KEY, "report.pdf")


def _flip(ch: str) -> str:
    return "0" if ch != "0" else "1"


def test_tampered_signature_rejected() -> None:
    token = create_download_token(KEY, filename="a.txt", ttl_seconds=60)
    payload, sig = token.split(".")
    with pytest.raises(Forbidden) as exc:
        verify_download_token(f"{payload}.{sig[:-1]}{_flip(sig[-1])}")
    assert exc.value.code == "invalid_download_token"


def test_tampered_payload_rejected() -> None:
    other_key = object_key_for(uuid.uuid4(), uuid.uuid4())
    token = create_download_token(KEY, filename="a.txt", ttl_seconds=60)
    forged = create_download_token(other_key, filename="a.txt", ttl_seconds=60)
    with pytest.raises(Forbidden):
        verify_download_token(f"{forged.split('.')[0]}.{token.split('.')[1]}")


def test_token_signed_with_other_secret_rejected() -> None:
    other = get_settings().model_copy(update={"jwt_secret": SecretStr("another-secret-" + "y" * 40)})
    token = create_download_token(KEY, filename="a.txt", ttl_seconds=60, settings=other)
    with pytest.raises(Forbidden):
        verify_download_token(token)


def test_expired_token_rejected() -> None:
    token = create_download_token(KEY, filename="a.txt", ttl_seconds=10, now=time.time() - 3600)
    with pytest.raises(Forbidden) as exc:
        verify_download_token(token)
    assert exc.value.code == "download_token_expired"


@pytest.mark.parametrize("token", ["", "abc", "a.b.c", "x" * 5000, "!!!.zzz"])
def test_malformed_tokens_rejected(token: str) -> None:
    with pytest.raises(Forbidden):
        verify_download_token(token)


# ---------------------------------------------------------------------------- filenames
@pytest.mark.parametrize(("raw", "expected"), [
    ("../../etc/passwd", "passwd"),
    ("C:\\Users\\me\\report.pdf", "report.pdf"),
    ("a\x00b\x07.txt", "ab.txt"),
    ("CON.txt", "_CON.txt"),
    ("", "file"),
    (None, "file"),
    ("...hidden", "hidden"),
    ('bad<>:"|?*name.txt', "bad_______name.txt"),
])
def test_sanitize_filename(raw: str | None, expected: str) -> None:
    assert sanitize_filename(raw) == expected


def test_sanitize_filename_bounds_length_keeping_extension() -> None:
    name = sanitize_filename("x" * 500 + ".pdf")
    assert len(name) <= 200 and name.endswith(".pdf")


def test_content_disposition_is_attachment_with_safe_names() -> None:
    header = content_disposition('résumé "final";.pdf')
    assert header.startswith('attachment; filename="')
    ascii_part = header.split('filename="')[1].split('"')[0]
    assert '"' not in ascii_part and ";" not in ascii_part
    assert "filename*=UTF-8''r%C3%A9sum%C3%A9" in header


# ---------------------------------------------------------------------------- S3
class _Body:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False

    def read(self) -> bytes:
        return self.data

    def close(self) -> None:
        self.closed = True


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.presign_calls: list[dict[str, Any]] = []

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str) -> dict[str, Any]:
        self.objects[Key] = (Body, ContentType)
        return {}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
                              "GetObject")
        return {"Body": _Body(self.objects[Key][0])}

    def delete_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        self.objects.pop(Key, None)
        return {}

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
                              "HeadObject")
        return {}

    def generate_presigned_url(self, method: str, *, Params: dict[str, Any], ExpiresIn: int) -> str:
        self.presign_calls.append({"method": method, "params": Params, "expires": ExpiresIn})
        return f"https://s3.example/{Params['Key']}?sig=1"


async def test_s3_storage_with_fake_client() -> None:
    client = FakeS3Client()
    storage = S3Storage(get_settings(), client=client, bucket="b")
    await storage.put_bytes(KEY, b"data", "application/pdf")
    assert await storage.exists(KEY)
    assert await storage.get_bytes(KEY) == b"data"
    url = await storage.signed_download_url(KEY, filename="x.pdf", ttl_seconds=120)
    assert url.startswith("https://s3.example/")
    call = client.presign_calls[0]
    assert call["method"] == "get_object" and call["expires"] == 120
    assert call["params"]["ResponseContentDisposition"].startswith("attachment;")
    assert call["params"]["ResponseContentType"] == "application/octet-stream"
    await storage.delete(KEY)
    await storage.delete(KEY)
    assert not await storage.exists(KEY)
    with pytest.raises(ObjectNotFound):
        await storage.get_bytes(KEY)
    with pytest.raises(UnsafeObjectKey):
        await storage.put_bytes("../x", b"", "text/plain")


def test_s3_error_mapping() -> None:
    def client_error(code: str, status: int) -> ClientError:
        return ClientError({"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "Op")

    assert isinstance(_map_s3_error(client_error("NoSuchKey", 404)), ObjectNotFound)
    assert isinstance(_map_s3_error(client_error("SlowDown", 503)), IntegrationRateLimited)
    assert isinstance(_map_s3_error(client_error("InternalError", 500)), IntegrationUnavailable)
    assert type(_map_s3_error(client_error("AccessDenied", 403))) is IntegrationError
    assert isinstance(_map_s3_error(ReadTimeoutError(endpoint_url="http://s3")), IntegrationTimeout)
    assert isinstance(_map_s3_error(EndpointConnectionError(endpoint_url="http://s3")), IntegrationUnavailable)


async def test_build_storage_selects_backend(tmp_path: Path) -> None:
    local = build_storage(get_settings().model_copy(update={"local_storage_path": str(tmp_path)}))
    assert isinstance(local, LocalFilesystemStorage)
    s3_settings = get_settings().model_copy(update={
        "object_storage_backend": "s3", "object_storage_endpoint": "http://minio.invalid:9000",
        "object_storage_access_key": SecretStr("AKIDEXAMPLE"),
        "object_storage_secret_key": SecretStr("secret-example"), "object_storage_bucket": "agentos-test",
    })
    s3 = build_storage(s3_settings)
    assert isinstance(s3, S3Storage)
    url = await s3.signed_download_url(KEY, filename="report.pdf", ttl_seconds=60)
    parts = urlsplit(url)
    assert parts.netloc == "minio.invalid:9000"
    assert parts.path == f"/agentos-test/{KEY}"
    query = parse_qs(parts.query)
    assert query["response-content-disposition"][0].startswith("attachment;")
    assert query["X-Amz-Expires"] == ["60"]
