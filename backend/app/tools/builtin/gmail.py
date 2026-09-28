"""Gmail tools. E-mail content is UNTRUSTED external content."""

from __future__ import annotations

import asyncio
import base64
import hashlib
from email.message import EmailMessage
from email.utils import formatdate
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.common.sanitize import clean_text
from app.core.exceptions import InsufficientScope, IntegrationNotFound
from app.integrations.google.oauth import CAPABILITY_SCOPES
from app.organizations.schemas import OrganizationPolicy
from app.tools.base import (
    IdempotencyStrategy,
    ReconcileOutcome,
    ReconcileStatus,
    RetryPolicy,
    RiskAssessment,
    Tool,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.verification.types import Difference, VerificationMethod, VerificationOutcome

READ_SCOPES = CAPABILITY_SCOPES["gmail.read"]
SEND_SCOPES = CAPABILITY_SCOPES["gmail.send"]
COMPOSE_SCOPES = CAPABILITY_SCOPES["gmail.compose"]


def message_id_for(idempotency_key: str) -> str:
    return f"<{hashlib.sha256(idempotency_key.encode()).hexdigest()[:40]}@agentos.mail>"


def _headers(msg: dict[str, Any]) -> dict[str, str]:
    return {h.get("name", "").lower(): h.get("value", "") for h in (msg.get("payload") or {}).get("headers", [])}


def _decode(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")
    except (ValueError, TypeError):
        return ""


def extract_body(payload: dict[str, Any]) -> str:
    """Prefer text/plain; fall back to stripped text/html. Depth-first over MIME parts."""
    plain: list[str] = []
    html: list[str] = []

    def walk(part: dict[str, Any], depth: int = 0) -> None:
        if depth > 10:
            return
        mime = part.get("mimeType", "")
        data = (part.get("body") or {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode(data))
        elif data and mime == "text/html":
            html.append(_decode(data))
        for sub in part.get("parts", []) or []:
            walk(sub, depth + 1)

    walk(payload)
    if plain:
        return clean_text("\n".join(plain), max_chars=20_000)
    return clean_text("\n".join(html), max_chars=20_000, strip_html=True)


def build_mime(*, to: list[str], cc: list[str], bcc: list[str], subject: str, body: str, message_id: str,
               in_reply_to: str | None = None) -> bytes:
    msg = EmailMessage()
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if bcc:
        msg["Bcc"] = ", ".join(bcc)
    msg["Subject"] = subject
    msg["Message-ID"] = message_id
    msg["Date"] = formatdate(localtime=False, usegmt=True)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)
    return msg.as_bytes()


# ---------------------------------------------------------------------------- search
class SearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(default="in:inbox newer_than:2d", max_length=500,
                       description="Gmail search syntax, e.g. 'is:unread newer_than:1d'")
    max_results: int = Field(default=10, ge=1, le=25)


class MessageSummary(BaseModel):
    id: str
    thread_id: str | None = None
    sender: str = ""
    to: str = ""
    subject: str = ""
    date: str = ""
    snippet: str = ""


class SearchOut(BaseModel):
    messages: list[MessageSummary]
    query: str


class GmailSearchTool(Tool[SearchIn, SearchOut]):
    input_model = SearchIn
    output_model = SearchOut
    spec = ToolSpec(
        name="gmail.search", description="Search the mailbox and return message headers and snippets",
        category="email", provider="google", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW,
        required_scopes=READ_SCOPES, timeout_seconds=30, output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    async def execute(self, tctx: ToolContext, args: SearchIn) -> ToolResult:
        g = await tctx.services.google(tctx, READ_SCOPES)
        refs = await g.gmail.list_messages(query=args.query, max_results=args.max_results)
        sem = asyncio.Semaphore(5)

        async def fetch(ref: dict[str, Any]) -> MessageSummary:
            async with sem:
                msg = await g.gmail.get_message(ref["id"], fmt="metadata",
                                                metadata_headers=["From", "To", "Subject", "Date"])
            h = _headers(msg)
            return MessageSummary(id=msg["id"], thread_id=msg.get("threadId"),
                                  sender=clean_text(h.get("from", ""), max_chars=300),
                                  to=clean_text(h.get("to", ""), max_chars=500),
                                  subject=clean_text(h.get("subject", ""), max_chars=300),
                                  date=h.get("date", "")[:100],
                                  snippet=clean_text(msg.get("snippet", ""), max_chars=500, strip_html=True))

        messages = list(await asyncio.gather(*(fetch(r) for r in refs)))
        return ToolResult(output=SearchOut(messages=messages, query=args.query).model_dump(),
                          summary=f"Found {len(messages)} e-mail(s)", trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


# ---------------------------------------------------------------------------- read
class ReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(min_length=1, max_length=200)


class ReadOut(BaseModel):
    id: str
    thread_id: str | None
    sender: str
    to: str
    cc: str
    subject: str
    date: str
    body: str
    message_id_header: str | None = None


class GmailReadTool(Tool[ReadIn, ReadOut]):
    input_model = ReadIn
    output_model = ReadOut
    spec = ToolSpec(
        name="gmail.read_message", description="Read one e-mail's headers and plain-text body",
        category="email", provider="google", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW,
        required_scopes=READ_SCOPES, timeout_seconds=20, output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    async def execute(self, tctx: ToolContext, args: ReadIn) -> ToolResult:
        g = await tctx.services.google(tctx, READ_SCOPES)
        msg = await g.gmail.get_message(args.message_id, fmt="full")
        h = _headers(msg)
        out = ReadOut(id=msg["id"], thread_id=msg.get("threadId"), sender=clean_text(h.get("from", ""), max_chars=300),
                      to=clean_text(h.get("to", ""), max_chars=1000), cc=clean_text(h.get("cc", ""), max_chars=1000),
                      subject=clean_text(h.get("subject", ""), max_chars=500), date=h.get("date", "")[:100],
                      body=extract_body(msg.get("payload") or {}), message_id_header=h.get("message-id"))
        return ToolResult(output=out.model_dump(), summary=f"Read e-mail “{out.subject[:80]}”",
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


# ---------------------------------------------------------------------------- send / draft
class ComposeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to: list[EmailStr] = Field(min_length=1, max_length=50)
    cc: list[EmailStr] = Field(default_factory=list, max_length=50)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=50)
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50_000)
    in_reply_to: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _limits(self) -> ComposeIn:
        if len(self.to) + len(self.cc) + len(self.bcc) > 50:
            raise ValueError("at most 50 recipients")
        return self

    def recipients(self) -> list[str]:
        return [str(x).lower() for x in [*self.to, *self.cc, *self.bcc]]


class SendOut(BaseModel):
    message_id: str
    thread_id: str | None = None
    label_ids: list[str] = Field(default_factory=list)
    message_id_header: str
    to: list[str]
    subject: str
    reconciled: bool = False


def _assess_recipients(args: ComposeIn, policy: OrganizationPolicy, base: PermissionLevel
                       ) -> RiskAssessment:
    internal = {d.lower() for d in policy.internal_email_domains}
    recipients = args.recipients()
    external = [r for r in recipients if r.split("@")[-1] not in internal]
    reasons: list[str] = []
    risk = RiskLevel.MEDIUM
    if external:
        risk = RiskLevel.HIGH
        reasons.append(f"{len(external)} recipient(s) outside the organization")
    if len(recipients) > 20:
        risk = RiskLevel.CRITICAL
        reasons.append("more than 20 recipients")
    return RiskAssessment(permission_level=base, risk_level=risk, requires_approval=True, reasons=reasons)


class GmailSendTool(Tool[ComposeIn, SendOut]):
    input_model = ComposeIn
    output_model = SendOut
    spec = ToolSpec(
        name="gmail.send", description="Send an e-mail from the user's mailbox", category="email",
        provider="google", permission_level=PermissionLevel.HIGH_RISK_WRITE, risk_level=RiskLevel.HIGH,
        required_scopes=SEND_SCOPES, requires_approval=True,
        idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP, timeout_seconds=30,
        retry_policy=RetryPolicy(max_attempts=2), parallel_safe=False,
        verification_method=VerificationMethod.PROVIDER_CONFIRMATION,
        reconcile_settle_seconds=120,
    )

    def assess(self, args: ComposeIn, policy: OrganizationPolicy) -> RiskAssessment:
        return _assess_recipients(args, policy, PermissionLevel.HIGH_RISK_WRITE)

    def describe(self, args: ComposeIn) -> str:
        return f"Send e-mail “{args.subject}” to {', '.join(str(t) for t in args.to)}"

    def target(self, args: ComposeIn) -> str | None:
        return ",".join(str(t) for t in args.to)

    async def execute(self, tctx: ToolContext, args: ComposeIn) -> ToolResult:
        g = await tctx.services.google(tctx, SEND_SCOPES)
        header_id = message_id_for(tctx.idempotency_key)
        raw = build_mime(to=[str(t) for t in args.to], cc=[str(c) for c in args.cc], bcc=[str(b) for b in args.bcc],
                         subject=args.subject, body=args.body, message_id=header_id, in_reply_to=args.in_reply_to)
        sent = await g.gmail.send_raw(raw)
        out = SendOut(message_id=str(sent.get("id")), thread_id=sent.get("threadId"),
                      label_ids=list(sent.get("labelIds", [])), message_id_header=header_id,
                      to=[str(t) for t in args.to], subject=args.subject)
        return ToolResult(output=out.model_dump(), external_ref=out.message_id,
                          summary=f"Sent e-mail “{args.subject}” to {', '.join(out.to)}")

    async def verify(self, tctx: ToolContext, args: ComposeIn, result: ToolResult) -> VerificationOutcome:
        out = SendOut.model_validate(result.output)
        if not out.message_id or out.message_id == "None":
            return VerificationOutcome.failed_with(VerificationMethod.PROVIDER_CONFIRMATION,
                                                   [Difference(field="message_id", expected="present", observed=None)])
        # Strongest check: read the message back (needs gmail.readonly, which may not be granted).
        try:
            g = await tctx.services.google(tctx, READ_SCOPES)
            msg = await g.gmail.get_message(out.message_id, fmt="metadata",
                                            metadata_headers=["To", "Subject", "Message-ID"])
        except (InsufficientScope, IntegrationNotFound) as exc:
            if "SENT" in out.label_ids:
                return VerificationOutcome.passed_with(
                    VerificationMethod.PROVIDER_CONFIRMATION,
                    observed={"message_id": out.message_id, "label_ids": out.label_ids},
                    evidence={"note": "provider confirmed SENT; read-back unavailable", "reason": exc.code})
            return VerificationOutcome.failed_with(
                VerificationMethod.PROVIDER_CONFIRMATION,
                [Difference(field="label_ids", expected="SENT", observed=out.label_ids)], retryable=False)
        labels = msg.get("labelIds", [])
        h = _headers(msg)
        diffs = []
        if "SENT" not in labels:
            diffs.append(Difference(field="label_ids", expected="SENT", observed=labels))
        if h.get("subject", "") != args.subject:
            diffs.append(Difference(field="subject", expected=args.subject, observed=h.get("subject")))
        if (h.get("message-id") or "").strip() != out.message_id_header:
            diffs.append(Difference(field="message_id_header", expected=out.message_id_header,
                                    observed=h.get("message-id")))
        observed = {"label_ids": labels, "subject": h.get("subject"), "to": h.get("to")}
        if diffs:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK, diffs, observed=observed,
                                                   retryable="SENT" not in labels)
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, observed=observed,
                                               evidence={"message_id": out.message_id})

    async def reconcile(self, tctx: ToolContext, args: ComposeIn) -> ReconcileOutcome:
        header_id = message_id_for(tctx.idempotency_key)
        try:
            g = await tctx.services.google(tctx, READ_SCOPES)
            found = await g.gmail.find_by_message_id_header(header_id)
        except InsufficientScope:
            return ReconcileOutcome(status=ReconcileStatus.UNKNOWN,
                                    evidence={"reason": "gmail.readonly not granted; cannot check sent mail"})
        if not found:
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"message_id_header": header_id})
        msg = await g.gmail.get_message(found[0]["id"], fmt="minimal")
        out = SendOut(message_id=str(msg["id"]), thread_id=msg.get("threadId"),
                      label_ids=list(msg.get("labelIds", [])), message_id_header=header_id,
                      to=[str(t) for t in args.to], subject=args.subject, reconciled=True)
        return ReconcileOutcome(status=ReconcileStatus.FOUND, evidence={"message_id": out.message_id},
                                result=ToolResult(output=out.model_dump(), external_ref=out.message_id,
                                                  summary="Confirmed the e-mail was already sent"))


class DraftOut(BaseModel):
    draft_id: str
    message_id: str | None
    message_id_header: str
    subject: str


class GmailDraftTool(Tool[ComposeIn, DraftOut]):
    input_model = ComposeIn
    output_model = DraftOut
    spec = ToolSpec(
        name="gmail.create_draft", description="Create an e-mail draft (not sent)", category="email",
        provider="google", permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.LOW,
        required_scopes=COMPOSE_SCOPES, idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP,
        timeout_seconds=20, parallel_safe=False, verification_method=VerificationMethod.READ_BACK,
        reconcile_settle_seconds=60,
    )

    def describe(self, args: ComposeIn) -> str:
        return f"Draft e-mail “{args.subject}” to {', '.join(str(t) for t in args.to)}"

    async def execute(self, tctx: ToolContext, args: ComposeIn) -> ToolResult:
        g = await tctx.services.google(tctx, COMPOSE_SCOPES)
        header_id = message_id_for(tctx.idempotency_key)
        raw = build_mime(to=[str(t) for t in args.to], cc=[str(c) for c in args.cc], bcc=[str(b) for b in args.bcc],
                         subject=args.subject, body=args.body, message_id=header_id, in_reply_to=args.in_reply_to)
        draft = await g.gmail.create_draft(raw)
        out = DraftOut(draft_id=str(draft.get("id")), message_id=(draft.get("message") or {}).get("id"),
                       message_id_header=header_id, subject=args.subject)
        return ToolResult(output=out.model_dump(), external_ref=out.draft_id,
                          summary=f"Created draft “{args.subject}”")

    async def verify(self, tctx: ToolContext, args: ComposeIn, result: ToolResult) -> VerificationOutcome:
        out = DraftOut.model_validate(result.output)
        g = await tctx.services.google(tctx, COMPOSE_SCOPES)
        try:
            draft = await g.gmail.get_draft(out.draft_id)
        except IntegrationNotFound:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK,
                                                   [Difference(field="draft", expected="exists", observed=None)],
                                                   retryable=True)
        h = _headers(draft.get("message") or {})
        if h.get("subject", args.subject) != args.subject:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK, [
                Difference(field="subject", expected=args.subject, observed=h.get("subject"))])
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, evidence={"draft_id": out.draft_id})

    async def reconcile(self, tctx: ToolContext, args: ComposeIn) -> ReconcileOutcome:
        header_id = message_id_for(tctx.idempotency_key)
        g = await tctx.services.google(tctx, COMPOSE_SCOPES)
        drafts = await g.gmail.list_drafts(query=f"rfc822msgid:{header_id}", max_results=1)
        if not drafts:
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"message_id_header": header_id})
        draft = drafts[0]
        out = DraftOut(draft_id=str(draft.get("id")), message_id=(draft.get("message") or {}).get("id"),
                       message_id_header=header_id, subject=args.subject)
        return ReconcileOutcome(status=ReconcileStatus.FOUND, result=ToolResult(
            output=out.model_dump(), external_ref=out.draft_id, summary="Confirmed the draft already exists"))


TOOLS: list[Tool[Any, Any]] = [GmailSearchTool(), GmailReadTool(), GmailSendTool(), GmailDraftTool()]
