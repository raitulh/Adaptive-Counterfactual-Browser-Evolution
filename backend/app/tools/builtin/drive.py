"""Google Drive tools (read-only by default; file content is UNTRUSTED)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.common.sanitize import clean_text, strip_markup
from app.core.exceptions import ToolInputInvalid
from app.integrations.google.oauth import CAPABILITY_SCOPES
from app.tools.base import Tool, ToolContext, ToolResult, ToolSpec

READ_SCOPES = CAPABILITY_SCOPES["drive.read"]
_TEXT_MIME = ("text/", "application/json", "application/vnd.google-apps.document",
              "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation")


class DriveSearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str | None = Field(default=None, max_length=200, description="Full-text search terms")
    max_results: int = Field(default=10, ge=1, le=50)


class DriveFile(BaseModel):
    id: str
    name: str
    mime_type: str
    modified_time: str | None = None
    size: int | None = None
    web_view_link: str | None = None
    owner: str | None = None


class DriveSearchOut(BaseModel):
    files: list[DriveFile]


class DriveSearchTool(Tool[DriveSearchIn, DriveSearchOut]):
    input_model = DriveSearchIn
    output_model = DriveSearchOut
    spec = ToolSpec(name="drive.search", description="Search Google Drive files by content or name",
                    category="files", provider="google", permission_level=PermissionLevel.READ,
                    risk_level=RiskLevel.LOW, required_scopes=READ_SCOPES, timeout_seconds=20,
                    output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)

    async def execute(self, tctx: ToolContext, args: DriveSearchIn) -> ToolResult:
        g = await tctx.services.google(tctx, READ_SCOPES)
        files = await g.drive.search(query=args.query, page_size=args.max_results)
        out = DriveSearchOut(files=[DriveFile(
            id=f["id"], name=clean_text(f.get("name", ""), max_chars=300), mime_type=f.get("mimeType", ""),
            modified_time=f.get("modifiedTime"), size=int(f["size"]) if f.get("size") else None,
            web_view_link=f.get("webViewLink"),
            owner=((f.get("owners") or [{}])[0] or {}).get("emailAddress")) for f in files])
        return ToolResult(output=out.model_dump(), summary=f"Found {len(out.files)} Drive file(s)",
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


class DriveReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(min_length=1, max_length=200)
    max_chars: int = Field(default=20_000, ge=500, le=100_000)


class DriveReadOut(BaseModel):
    file_id: str
    name: str
    mime_type: str
    text: str
    truncated: bool


class DriveReadTool(Tool[DriveReadIn, DriveReadOut]):
    input_model = DriveReadIn
    output_model = DriveReadOut
    spec = ToolSpec(name="drive.read_file", description="Read the text content of a Google Drive document",
                    category="files", provider="google", permission_level=PermissionLevel.READ,
                    risk_level=RiskLevel.LOW, required_scopes=READ_SCOPES, timeout_seconds=30,
                    output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)

    async def execute(self, tctx: ToolContext, args: DriveReadIn) -> ToolResult:
        g = await tctx.services.google(tctx, READ_SCOPES)
        meta = await g.drive.get_metadata(args.file_id)
        mime = str(meta.get("mimeType", ""))
        if not mime.startswith(_TEXT_MIME):
            raise ToolInputInvalid("Only text-like Drive files can be read by this tool",
                                   details={"mime_type": mime})
        raw = (await g.drive.read_text(args.file_id, mime)).decode("utf-8", errors="replace")
        if "html" in mime:
            raw = strip_markup(raw)
        text = clean_text(raw, max_chars=args.max_chars)
        out = DriveReadOut(file_id=args.file_id, name=clean_text(str(meta.get("name", "")), max_chars=300),
                           mime_type=mime, text=text, truncated=len(raw) > args.max_chars)
        return ToolResult(output=out.model_dump(), summary=f"Read Drive file “{out.name}”",
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


TOOLS: list[Tool[Any, Any]] = [DriveSearchTool(), DriveReadTool()]
