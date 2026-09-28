"""files.* tools against the real database and local object storage."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from files_fixtures import ApiUser, ControlledScanner
from sqlalchemy import func, select

from app.core.database import get_session_factory
from app.core.exceptions import ToolError, ToolInputInvalid
from app.files.models import File, FilePurpose
from app.files.storage import LocalFilesystemStorage
from app.files.tools import (
    TOOLS,
    ListFilesIn,
    ListFilesTool,
    ReadTextIn,
    ReadTextTool,
    WriteTextIn,
    WriteTextTool,
    deterministic_file_id,
)
from app.tools.base import ReconcileStatus, ToolContext
from app.tools.registry import ToolRegistry

pytestmark = pytest.mark.integration

Register = Callable[[], Awaitable[ApiUser]]
MakeTctx = Callable[..., ToolContext]
RunJob = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


async def _count(stmt: Any) -> int:
    async with get_session_factory()() as session:
        session.info["system"] = True
        return int((await session.execute(stmt)).scalar_one())


def test_tools_register_with_schemas_and_verifiers() -> None:
    registry = ToolRegistry()
    for tool in TOOLS:
        registry.register(tool)
    specs = {t.spec.name: t.spec for t in TOOLS}
    assert set(specs) == {"files.list", "files.read_text", "files.write_text"}
    assert specs["files.read_text"].output_trust == "untrusted_external_content"
    assert specs["files.write_text"].permission_level == "write" and specs["files.write_text"].risk_level == "low"
    assert specs["files.list"].permission_level == "read"


async def test_write_text_is_idempotent_verified_and_reconcilable(
        register: Register, make_tctx: MakeTctx, storage: LocalFilesystemStorage,
        scanner: ControlledScanner) -> None:
    user = await register()
    tool = WriteTextTool()
    key = f"task-step-{uuid.uuid4().hex}"
    args = WriteTextIn(filename="summary", content="# Summary\n\n- point one\n- point two\n", format="markdown")
    tctx = make_tctx(user, idempotency_key=key)
    result = await tool.execute(tctx, args)
    out = result.output
    file_id = uuid.UUID(out["file_id"])
    assert file_id == deterministic_file_id(user.tenant_id, key)
    assert out["filename"] == "summary.md" and out["content_type"] == "text/markdown"
    assert out["sha256"] == hashlib.sha256(args.content.encode()).hexdigest() and not out["already_existed"]
    assert result.external_ref == str(file_id)
    assert (await tool.verify(tctx, args, result)).passed

    retry = await tool.execute(make_tctx(user, idempotency_key=key), args)
    assert retry.output["file_id"] == out["file_id"] and retry.output["already_existed"]
    assert await _count(select(func.count()).select_from(File).where(File.id == file_id)) == 1
    row_purpose = await _count(select(func.count()).select_from(File).where(
        File.id == file_id, File.purpose == FilePurpose.TASK_ARTIFACT, File.user_id == user.user_id))
    assert row_purpose == 1

    found = await tool.reconcile(tctx, args)
    assert found.status == ReconcileStatus.FOUND and found.result is not None
    assert found.result.output["file_id"] == out["file_id"]
    fresh = await tool.reconcile(make_tctx(user, idempotency_key="never-executed-key"), args)
    assert fresh.status == ReconcileStatus.NOT_FOUND

    with pytest.raises(ToolError) as exc:
        await tool.execute(make_tctx(user, idempotency_key=key), args.model_copy(update={"content": "changed"}))
    assert exc.value.code == "idempotency_conflict"

    object_key = f"tenants/{user.tenant_id}/files/{file_id}"
    await storage.put_bytes(object_key, b"tampered", "text/markdown")
    tampered = await tool.verify(tctx, args, result)
    assert not tampered.passed and {d.field for d in tampered.differences} >= {"sha256", "size_bytes"}
    assert (await tool.reconcile(tctx, args)).status == ReconcileStatus.UNKNOWN

    await storage.delete(object_key)
    missing = await tool.verify(tctx, args, result)
    assert not missing.passed and missing.differences[0].field == "object"
    assert (await tool.reconcile(tctx, args)).status == ReconcileStatus.NOT_FOUND
    repaired = await tool.execute(make_tctx(user, idempotency_key=key), args)  # retry repairs the object
    assert repaired.output["already_existed"]
    assert await storage.get_bytes(object_key) == args.content.encode()
    assert (await tool.verify(tctx, args, result)).passed


async def test_list_and_read_text(register: Register, make_tctx: MakeTctx, storage: LocalFilesystemStorage,
                                  scanner: ControlledScanner, run_process_job: RunJob) -> None:
    owner, stranger = await register(), await register()
    content = "\n\n".join(f"Paragraph {i}: the lighthouse keeper logs weather {i}. " * 6 for i in range(15))
    written = await WriteTextTool().execute(make_tctx(owner), WriteTextIn(filename="log.txt", content=content))
    file_id = uuid.UUID(written.output["file_id"])

    reader = ReadTextTool()
    with pytest.raises(ToolError) as exc:
        await reader.execute(make_tctx(owner), ReadTextIn(file_id=file_id))
    assert exc.value.code == "file_not_ready"
    await run_process_job(owner.tenant_id, file_id)

    first = await reader.execute(make_tctx(owner), ReadTextIn(file_id=file_id, max_chars=1000))
    assert first.trust == "untrusted_external_content"
    assert first.output["truncated"] and first.output["next_offset"] == 1000
    assert first.output["text"].startswith("Paragraph 0: the lighthouse keeper")
    full = await reader.execute(make_tctx(owner), ReadTextIn(file_id=file_id, max_chars=100_000))
    assert " ".join(full.output["text"].split()) == " ".join(content.split())
    assert not full.output["truncated"] and full.output["next_offset"] is None
    rest = await reader.execute(make_tctx(owner), ReadTextIn(file_id=file_id, offset=1000, max_chars=100_000))
    assert first.output["text"] + rest.output["text"] == full.output["text"]

    with pytest.raises(ToolInputInvalid):
        await reader.execute(make_tctx(stranger), ReadTextIn(file_id=file_id))

    listed = await ListFilesTool().execute(make_tctx(owner), ListFilesIn())
    assert [f["file_id"] for f in listed.output["files"]] == [str(file_id)]
    assert (await ListFilesTool().execute(make_tctx(stranger), ListFilesIn())).output["files"] == []
    artifacts = await ListFilesTool().execute(make_tctx(owner), ListFilesIn(purpose="temp"))
    assert artifacts.output["files"] == []
