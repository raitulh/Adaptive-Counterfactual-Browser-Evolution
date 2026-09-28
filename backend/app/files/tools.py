"""files tools: list the user's files, read extracted text, write new text files."""

from __future__ import annotations

import contextlib
import hashlib
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import ErrorClass, PermissionLevel, RiskLevel, TrustLevel
from app.core.exceptions import NotFound, ToolError, ToolInputInvalid
from app.files import service
from app.files.models import File, FilePurpose, FileStatus
from app.files.processing import CSV, MARKDOWN, TEXT_PLAIN
from app.files.storage import ObjectNotFound, object_key_for, sanitize_filename
from app.tools.base import (
    IdempotencyStrategy,
    ReconcileOutcome,
    ReconcileStatus,
    RetryPolicy,
    Tool,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.verification.types import Difference, VerificationMethod, VerificationOutcome, compare_fields


@contextlib.asynccontextmanager
async def _tenant_session(tctx: ToolContext) -> AsyncIterator[AsyncSession]:
    async with tctx.services.session_factory() as session:
        session.info["tenant_id"] = tctx.tenant_id
        yield session


async def _load_file(tctx: ToolContext, file_id: uuid.UUID) -> File | None:
    async with _tenant_session(tctx) as session:
        stmt = select(File).where(File.id == file_id, File.tenant_id == tctx.tenant_id,
                                  File.user_id == tctx.user_id)
        return (await session.execute(stmt)).scalar_one_or_none()


# ---------------------------------------------------------------------------- files.list
class ListFilesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: Literal["user_upload", "task_artifact", "browser_artifact", "temp"] | None = None
    limit: int = Field(default=20, ge=1, le=50)


class FileSummary(BaseModel):
    file_id: str
    filename: str
    content_type: str
    size_bytes: int
    status: str
    purpose: str
    created_at: str


class ListFilesOut(BaseModel):
    files: list[FileSummary]


class ListFilesTool(Tool[ListFilesIn, ListFilesOut]):
    input_model = ListFilesIn
    output_model = ListFilesOut
    spec = ToolSpec(
        name="files.list", description="List the user's files (most recent first)", category="files",
        permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW, timeout_seconds=15,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    async def execute(self, tctx: ToolContext, args: ListFilesIn) -> ToolResult:
        async with _tenant_session(tctx) as session:
            stmt = select(File).where(File.tenant_id == tctx.tenant_id, File.user_id == tctx.user_id,
                                      File.deleted_at.is_(None))
            if args.purpose:
                stmt = stmt.where(File.purpose == args.purpose)
            rows = (await session.execute(stmt.order_by(File.created_at.desc(), File.id.desc())
                                          .limit(args.limit))).scalars().all()
        out = ListFilesOut(files=[FileSummary(
            file_id=str(f.id), filename=f.filename, content_type=f.content_type, size_bytes=f.size_bytes,
            status=f.status, purpose=f.purpose, created_at=f.created_at.isoformat()) for f in rows])
        return ToolResult(output=out.model_dump(), summary=f"Listed {len(out.files)} file(s)",
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


# ---------------------------------------------------------------------------- files.read_text
class ReadTextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: uuid.UUID
    offset: int = Field(default=0, ge=0, description="Character offset to start reading from")
    max_chars: int = Field(default=20_000, ge=100, le=100_000)


class ReadTextOut(BaseModel):
    file_id: str
    filename: str
    content_type: str
    text: str
    offset: int
    total_chars: int
    truncated: bool
    next_offset: int | None = None


class ReadTextTool(Tool[ReadTextIn, ReadTextOut]):
    input_model = ReadTextIn
    output_model = ReadTextOut
    spec = ToolSpec(
        name="files.read_text", description="Read the extracted text of one of the user's files",
        category="files",
        permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW, timeout_seconds=20,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    def target(self, args: ReadTextIn) -> str | None:
        return f"file:{args.file_id}"

    async def execute(self, tctx: ToolContext, args: ReadTextIn) -> ToolResult:
        async with _tenant_session(tctx) as session:
            try:
                data = await service.read_file_text(session, tenant_id=tctx.tenant_id, user_id=tctx.user_id,
                                                    file_id=args.file_id, offset=args.offset,
                                                    max_chars=args.max_chars)
            except NotFound as exc:
                raise ToolInputInvalid("No such file for this user.",
                                       details={"file_id": str(args.file_id)}) from exc
        status = data["status"]
        if status in (FileStatus.UPLOADED, FileStatus.PROCESSING) and not data["total_chars"]:
            raise ToolError("The file is still being processed; try again shortly.", code="file_not_ready",
                            error_class=ErrorClass.TRANSIENT)
        if status == FileStatus.FAILED:
            raise ToolError("Text could not be extracted from this file.", code="file_unreadable",
                            error_class=ErrorClass.INVALID_INPUT)
        if status == FileStatus.QUARANTINED:
            raise ToolError("The file was quarantined by the malware scanner.", code="file_quarantined",
                            error_class=ErrorClass.POLICY_BLOCKED)
        out = ReadTextOut(file_id=str(data["file_id"]), filename=data["filename"],
                          content_type=data["content_type"], text=data["text"], offset=data["offset"],
                          total_chars=data["total_chars"],
                          truncated=data["truncated"], next_offset=data["next_offset"])
        return ToolResult(output=out.model_dump(), trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
                          summary=f"Read {len(out.text)} of {out.total_chars} characters "
                                  f"from “{out.filename}”")


# ---------------------------------------------------------------------------- files.write_text
_FORMATS: dict[str, tuple[str, str]] = {"text": (TEXT_PLAIN, ".txt"), "markdown": (MARKDOWN, ".md"),
                                        "csv": (CSV, ".csv")}


class WriteTextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=1_000_000)
    format: Literal["text", "markdown", "csv"] = "text"


class WriteTextOut(BaseModel):
    file_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    status: str
    already_existed: bool = False


def deterministic_file_id(tenant_id: uuid.UUID, idempotency_key: str) -> uuid.UUID:
    """Same logical action (idempotency key) → same file id → same object key."""
    digest = hashlib.sha256(f"files.write_text:{tenant_id}:{idempotency_key}".encode()).digest()
    return uuid.UUID(bytes=digest[:16], version=4)


def output_filename(filename: str, fmt: str) -> str:
    ext = _FORMATS[fmt][1]
    name = sanitize_filename(filename, default=f"document{ext}")
    return name if name.lower().endswith(ext) else f"{name[: 200 - len(ext)]}{ext}"


def _write_out(file: File, *, existed: bool) -> WriteTextOut:
    return WriteTextOut(file_id=str(file.id), filename=file.filename, content_type=file.content_type,
                        size_bytes=file.size_bytes, sha256=file.sha256, status=file.status,
                        already_existed=existed)


class WriteTextTool(Tool[WriteTextIn, WriteTextOut]):
    input_model = WriteTextIn
    output_model = WriteTextOut
    spec = ToolSpec(
        name="files.write_text", description="Create a new text, Markdown or CSV file for the user",
        category="files", permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.LOW,
        supports_idempotency=True, idempotency_strategy=IdempotencyStrategy.NATIVE_KEY, timeout_seconds=30,
        retry_policy=RetryPolicy(max_attempts=3), verification_method=VerificationMethod.CHECKSUM,
    )

    def describe(self, args: WriteTextIn) -> str:
        name = output_filename(args.filename, args.format)
        return f"Create file “{name}” ({len(args.content)} characters)"

    def target(self, args: WriteTextIn) -> str | None:
        return f"file:{output_filename(args.filename, args.format)}"

    def _result(self, out: WriteTextOut) -> ToolResult:
        suffix = " (already existed from a previous attempt)" if out.already_existed else ""
        return ToolResult(output=out.model_dump(), external_ref=out.file_id,
                          summary=f"Created file “{out.filename}” ({out.size_bytes} bytes){suffix}")

    async def _existing(self, tctx: ToolContext, file: File, data: bytes, sha256: str) -> ToolResult:
        if file.deleted_at is not None:
            raise ToolError("The file created by a previous attempt was deleted.", code="file_deleted",
                            error_class=ErrorClass.CONFLICT)
        if file.sha256 != sha256:
            raise ToolError("A different file was already written for this action.",
                            code="idempotency_conflict", error_class=ErrorClass.CONFLICT)
        storage = tctx.services.storage
        if not await storage.exists(file.object_key):  # repair a partially completed attempt
            await storage.put_bytes(file.object_key, data, file.content_type)
        return self._result(_write_out(file, existed=True))

    async def execute(self, tctx: ToolContext, args: WriteTextIn) -> ToolResult:
        content_type = _FORMATS[args.format][0]
        data = args.content.encode("utf-8")
        sha256 = hashlib.sha256(data).hexdigest()
        file_id = deterministic_file_id(tctx.tenant_id, tctx.idempotency_key)
        existing = await _load_file(tctx, file_id)
        if existing is not None:
            return await self._existing(tctx, existing, data, sha256)
        try:
            async with _tenant_session(tctx) as session:
                created = await service.upload_file(
                    session, tctx.ctx, data=data, filename=output_filename(args.filename, args.format),
                    purpose=FilePurpose.TASK_ARTIFACT, storage=tctx.services.storage, file_id=file_id,
                    task_id=tctx.task_id, preferred_text_type=content_type, delete_object_on_failure=False)
        except IntegrityError:
            winner = await _load_file(tctx, file_id)  # a concurrent attempt committed first
            if winner is None:
                raise
            return await self._existing(tctx, winner, data, sha256)
        return self._result(_write_out(created, existed=False))

    async def verify(self, tctx: ToolContext, args: WriteTextIn, result: ToolResult) -> VerificationOutcome:
        expected_sha = hashlib.sha256(args.content.encode("utf-8")).hexdigest()
        file_id = uuid.UUID(str(result.output.get("file_id")))
        key = object_key_for(tctx.tenant_id, file_id)
        row = await _load_file(tctx, file_id)
        storage = tctx.services.storage
        missing = VerificationOutcome.failed_with(
            VerificationMethod.CHECKSUM, [Difference(field="object", expected="exists", observed="missing")],
            expected={"sha256": expected_sha}, evidence={"file_id": str(file_id)})
        if not await storage.exists(key):
            return missing
        try:
            stored = await storage.get_bytes(key)
        except ObjectNotFound:  # deleted between the existence check and the read
            return missing
        expected = {"sha256": expected_sha, "record_sha256": expected_sha,
                    "size_bytes": len(args.content.encode("utf-8")), "record_live": True}
        observed = {"sha256": hashlib.sha256(stored).hexdigest(),
                    "record_sha256": row.sha256 if row is not None else None, "size_bytes": len(stored),
                    "record_live": row is not None and row.deleted_at is None}
        diffs = compare_fields(expected, observed)
        evidence = {"file_id": str(file_id), "object_key": key}
        if diffs:
            return VerificationOutcome.failed_with(VerificationMethod.CHECKSUM, diffs, expected=expected,
                                                   observed=observed, evidence=evidence)
        return VerificationOutcome.passed_with(VerificationMethod.CHECKSUM, expected=expected,
                                               observed=observed, evidence=evidence)

    async def reconcile(self, tctx: ToolContext, args: WriteTextIn) -> ReconcileOutcome:
        file_id = deterministic_file_id(tctx.tenant_id, tctx.idempotency_key)
        expected_sha = hashlib.sha256(args.content.encode("utf-8")).hexdigest()
        evidence: dict[str, object] = {"file_id": str(file_id)}
        row = await _load_file(tctx, file_id)
        if row is None:
            # Nothing recorded: a retry re-writes the same deterministic key, so it is safe.
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence=evidence)
        if row.deleted_at is not None or row.sha256 != expected_sha:
            return ReconcileOutcome(status=ReconcileStatus.UNKNOWN,
                                    evidence={**evidence, "reason": "deleted or different content"})
        storage = tctx.services.storage
        if not await storage.exists(row.object_key):
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND,
                                    evidence={**evidence, "object": "missing"})
        stored_sha = hashlib.sha256(await storage.get_bytes(row.object_key)).hexdigest()
        if stored_sha != expected_sha:
            return ReconcileOutcome(status=ReconcileStatus.UNKNOWN,
                                    evidence={**evidence, "reason": "checksum"})
        return ReconcileOutcome(status=ReconcileStatus.FOUND,
                                result=self._result(_write_out(row, existed=True)),
                                evidence={**evidence, "sha256": stored_sha})


TOOLS: list[Tool[Any, Any]] = [ListFilesTool(), ReadTextTool(), WriteTextTool()]
