"""Files HTTP API end to end: upload → scan → store → enqueue → process → download → delete,
with tenant/ownership isolation and the upload security controls."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from files_fixtures import ApiUser, ControlledScanner
from files_samples import EXE_BYTES, RANDOM_BINARY, make_pdf
from sqlalchemy import select

from app.audit.models import AuditLog
from app.core.config import get_settings
from app.core.database import get_session_factory
from app.files.models import File, FileStatus
from app.files.scanning import ScanResult, ScanStatus
from app.files.storage import LocalFilesystemStorage, create_download_token, object_key_for
from app.search.models import SearchChunk, SearchDocument
from app.usage.models import UsageEvent, UsageKind
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration

Register = Callable[[], Awaitable[ApiUser]]
RunJob = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


async def _upload(api: httpx.AsyncClient, user: ApiUser, data: bytes, *, filename: str = "notes.txt",
                  content_type: str = "text/plain", purpose: str | None = None,
                  headers: dict[str, str] | None = None) -> httpx.Response:
    form = {"purpose": purpose} if purpose else None
    return await api.post("/api/v1/files", headers={**user.headers, **(headers or {})},
                          files={"file": (filename, data, content_type)}, data=form)


async def _rows(stmt: Any) -> list[Any]:
    async with get_session_factory()() as session:
        session.info["system"] = True
        return list((await session.execute(stmt)).scalars().all())


def _token(url: str) -> str:
    return parse_qs(urlsplit(url).query)["token"][0]


async def test_upload_process_download_delete_lifecycle(
        api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage, scanner: ControlledScanner,
        run_process_job: RunJob) -> None:
    user = await register()
    body = ("Quarterly planning notes.\n\n" + "The zebra migration project is on track. " * 40).encode()
    # The client claims PNG; the server sniffs the bytes and records text/plain.
    resp = await _upload(api, user, body, filename="../../etc/photo.png", content_type="image/png")
    assert resp.status_code == 201, resp.text
    created = resp.json()
    file_id = uuid.UUID(created["id"])
    assert created["content_type"] == "text/plain"
    assert created["filename"] == "photo.png"
    assert created["status"] == FileStatus.UPLOADED and created["scan_status"] == ScanStatus.CLEAN
    assert created["size_bytes"] == len(body) and created["purpose"] == "user_upload"
    assert scanner.scanned == [body]
    key = object_key_for(user.tenant_id, file_id)
    assert await storage.get_bytes(key) == body

    jobs = await _rows(select(Job).where(Job.dedupe_key == f"file.process:{file_id}"))
    assert len(jobs) == 1 and jobs[0].job_type == "file.process" and jobs[0].queue == "files"
    usage = await _rows(select(UsageEvent).where(UsageEvent.tenant_id == user.tenant_id,
                                                 UsageEvent.kind == UsageKind.STORAGE_BYTES))
    assert [u.quantity for u in usage] == [float(len(body))]

    await run_process_job(user.tenant_id, file_id)
    detail = (await api.get(f"/api/v1/files/{file_id}", headers=user.headers)).json()
    assert detail["status"] == FileStatus.READY
    assert detail["metadata"]["extraction_status"] == "completed"
    assert detail["metadata"]["char_count"] > 1000 and detail["metadata"]["chunk_count"] >= 1
    assert detail["metadata"]["language"] == "en"
    docs = await _rows(select(SearchDocument).where(SearchDocument.source_id == str(file_id)))
    assert len(docs) == 1 and docs[0].source_type == "file" and docs[0].user_id == user.user_id
    chunks = await _rows(select(SearchChunk).where(SearchChunk.document_id == docs[0].id))
    assert chunks and all(c.embedding is not None for c in chunks)

    listing = (await api.get("/api/v1/files", headers=user.headers)).json()
    assert [item["id"] for item in listing["items"]] == [str(file_id)]

    link = (await api.get(f"/api/v1/files/{file_id}/download-url", headers=user.headers)).json()
    assert link["filename"] == "photo.png"
    download = await api.get("/api/v1/files/download", params={"token": _token(link["url"])})
    assert download.status_code == 200 and download.content == body
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["x-content-type-options"] == "nosniff"
    assert download.headers["content-type"] == "application/octet-stream"

    deleted = await api.delete(f"/api/v1/files/{file_id}", headers=user.headers)
    assert deleted.status_code == 204
    assert (await api.get(f"/api/v1/files/{file_id}", headers=user.headers)).status_code == 404
    assert not await storage.exists(key)
    assert await _rows(select(SearchDocument).where(SearchDocument.source_id == str(file_id))) == []
    assert await _rows(select(SearchChunk).where(SearchChunk.document_id == docs[0].id)) == []
    delete_jobs = await _rows(select(Job).where(Job.job_type == "file.delete_objects",
                                                Job.tenant_id == user.tenant_id))
    assert delete_jobs and delete_jobs[0].payload["keys"] == [key]
    again = await api.get("/api/v1/files/download", params={"token": _token(link["url"])})
    assert again.status_code == 404
    assert (await api.delete(f"/api/v1/files/{file_id}", headers=user.headers)).status_code == 404


async def test_cross_tenant_access_is_not_found(
        api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage,
        scanner: ControlledScanner) -> None:
    owner, intruder = await register(), await register()
    file_id = (await _upload(api, owner, b"private owner data")).json()["id"]
    for method, path in (("GET", f"/api/v1/files/{file_id}"), ("GET", f"/api/v1/files/{file_id}/download-url"),
                         ("DELETE", f"/api/v1/files/{file_id}")):
        resp = await api.request(method, path, headers=intruder.headers)
        assert resp.status_code == 404, (method, path, resp.text)
        assert resp.json()["error"]["code"] == "not_found"
    assert (await api.get("/api/v1/files", headers=intruder.headers)).json()["items"] == []
    assert (await api.get(f"/api/v1/files/{file_id}", headers=owner.headers)).status_code == 200
    assert (await api.get("/api/v1/files", headers={"Authorization": "Bearer nope"})).status_code == 401


async def test_upload_rejections(api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage,
                                 scanner: ControlledScanner, monkeypatch: pytest.MonkeyPatch) -> None:
    user = await register()
    for data, name, ctype in ((EXE_BYTES, "report.pdf", "application/pdf"),
                              (RANDOM_BINARY, "data.csv", "text/csv"),
                              (b"#!/bin/sh\necho pwned\n", "script.txt", "text/plain")):
        resp = await _upload(api, user, data, filename=name, content_type=ctype)
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "unsupported_file_type"
    empty = await _upload(api, user, b"")
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "empty_file"
    bad_purpose = await _upload(api, user, b"hello", purpose="task_artifact")
    assert bad_purpose.status_code == 422

    monkeypatch.setattr(get_settings(), "file_max_upload_bytes", 1024)
    too_big = await _upload(api, user, b"a" * 5000)
    assert too_big.status_code == 413 and too_big.json()["error"]["code"] == "payload_too_large"
    assert await _rows(select(File).where(File.tenant_id == user.tenant_id)) == []
    assert not any(p.is_file() for p in storage.root.rglob("*"))


async def test_infected_upload_is_quarantined_and_audited(
        api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage,
        scanner: ControlledScanner) -> None:
    user = await register()
    scanner.result = ScanResult(status=ScanStatus.INFECTED, signature="Eicar-Test-Signature", scanner="fake")
    resp = await _upload(api, user, b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "malware_detected"
    file_id = uuid.UUID(resp.json()["error"]["details"]["file_id"])
    rows = await _rows(select(File).where(File.id == file_id))
    assert rows[0].status == FileStatus.QUARANTINED and rows[0].scan_status == ScanStatus.INFECTED
    assert rows[0].scan_signature == "Eicar-Test-Signature"
    assert not await storage.exists(rows[0].object_key)
    audits = await _rows(select(AuditLog).where(AuditLog.tenant_id == user.tenant_id,
                                                AuditLog.action == "file.malware_detected"))
    assert len(audits) == 1 and audits[0].category == "security" and audits[0].status == "blocked"
    assert (await api.get(f"/api/v1/files/{file_id}/download-url", headers=user.headers)).status_code == 404
    assert await _rows(select(Job).where(Job.dedupe_key == f"file.process:{file_id}")) == []


async def test_scanner_outage_fails_closed(api: httpx.AsyncClient, register: Register,
                                           storage: LocalFilesystemStorage, scanner: ControlledScanner) -> None:
    user = await register()
    scanner.result = ScanResult(status=ScanStatus.ERROR, scanner="fake", detail="timeout")
    resp = await _upload(api, user, b"harmless text")
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "scan_unavailable"
    assert await _rows(select(File).where(File.tenant_id == user.tenant_id)) == []


async def test_download_token_tampering_and_expiry(
        api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage,
        scanner: ControlledScanner) -> None:
    user = await register()
    file_id = uuid.UUID((await _upload(api, user, b"secret contents")).json()["id"])
    link = (await api.get(f"/api/v1/files/{file_id}/download-url", headers=user.headers)).json()
    token = _token(link["url"])
    payload, signature = token.split(".")
    forged_sig = signature[:-1] + ("0" if signature[-1] != "0" else "1")
    resp = await api.get("/api/v1/files/download", params={"token": f"{payload}.{forged_sig}"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "invalid_download_token"
    other_key = object_key_for(user.tenant_id, uuid.uuid4())
    forged_payload = create_download_token(other_key, filename="x", ttl_seconds=60).split(".")[0]
    assert (await api.get("/api/v1/files/download",
                          params={"token": f"{forged_payload}.{signature}"})).status_code == 403
    expired = create_download_token(object_key_for(user.tenant_id, file_id), filename="x", ttl_seconds=5,
                                    now=time.time() - 600)
    resp = await api.get("/api/v1/files/download", params={"token": expired})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "download_token_expired"
    # A validly signed token for an object that is not a live file of that tenant.
    unknown = create_download_token(other_key, filename="x", ttl_seconds=60)
    assert (await api.get("/api/v1/files/download", params={"token": unknown})).status_code == 404


async def test_list_pagination_and_filters(api: httpx.AsyncClient, register: Register,
                                           storage: LocalFilesystemStorage, scanner: ControlledScanner) -> None:
    user = await register()
    ids = [(await _upload(api, user, f"file number {i}".encode(), filename=f"f{i}.txt")).json()["id"]
           for i in range(3)]
    temp = (await _upload(api, user, b"scratch", purpose="temp")).json()
    assert temp["expires_at"] is not None
    first = (await api.get("/api/v1/files", params={"limit": 2, "purpose": "user_upload"},
                           headers=user.headers)).json()
    assert first["has_more"] and len(first["items"]) == 2
    second = (await api.get("/api/v1/files", params={"limit": 2, "purpose": "user_upload",
                                                     "cursor": first["next_cursor"]}, headers=user.headers)).json()
    assert not second["has_more"]
    seen = [i["id"] for i in first["items"] + second["items"]]
    assert seen == list(reversed(ids))
    temps = (await api.get("/api/v1/files", params={"purpose": "temp"}, headers=user.headers)).json()
    assert [i["id"] for i in temps["items"]] == [temp["id"]]
    bad = await api.get("/api/v1/files", params={"cursor": "garbage!!"}, headers=user.headers)
    assert bad.status_code == 422


async def test_upload_idempotency_key_replays(api: httpx.AsyncClient, register: Register,
                                              storage: LocalFilesystemStorage, scanner: ControlledScanner) -> None:
    user = await register()
    headers = {"Idempotency-Key": f"upload-{uuid.uuid4().hex}"}
    first = await _upload(api, user, b"same bytes", headers=headers)
    second = await _upload(api, user, b"same bytes", headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert second.headers.get("idempotent-replayed") == "true"
    assert len(await _rows(select(File).where(File.tenant_id == user.tenant_id))) == 1
    reused = await _upload(api, user, b"different bytes", headers=headers)
    assert reused.status_code == 422 and reused.json()["error"]["code"] == "idempotency_key_reused"


async def test_pdf_upload_is_sniffed_and_processed(api: httpx.AsyncClient, register: Register,
                                                   storage: LocalFilesystemStorage, scanner: ControlledScanner,
                                                   run_process_job: RunJob) -> None:
    user = await register()
    resp = await _upload(api, user, make_pdf(["Invoice number 4411", "Total due: 99 EUR"]),
                         filename="invoice", content_type="application/octet-stream")
    assert resp.status_code == 201 and resp.json()["content_type"] == "application/pdf"
    file_id = uuid.UUID(resp.json()["id"])
    await run_process_job(user.tenant_id, file_id)
    meta = (await api.get(f"/api/v1/files/{file_id}", headers=user.headers)).json()["metadata"]
    assert meta["page_count"] == 2 and "Invoice number 4411" in meta["extracted_summary"]
