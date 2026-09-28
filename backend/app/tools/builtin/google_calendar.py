"""Google Calendar tools."""

from __future__ import annotations

import base64
import hashlib
from datetime import date, datetime, time, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.common.sanitize import clean_text
from app.common.time import resolve_timezone
from app.core.exceptions import IntegrationConflict, IntegrationNotFound, NeedsUserInput, ToolInputInvalid
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
from app.verification.types import Difference, VerificationMethod, VerificationOutcome, compare_fields

READ_SCOPES = CAPABILITY_SCOPES["calendar.read"]
WRITE_SCOPES = CAPABILITY_SCOPES["calendar.write"]


# ---------------------------------------------------------------------------- helpers
def resolve_date(value: str, tz_name: str, *, today: date | None = None) -> date:
    tz = resolve_timezone(tz_name)
    base = today or datetime.now(tz).date()
    lowered = value.strip().lower()
    if lowered == "today":
        return base
    if lowered == "tomorrow":
        return base + timedelta(days=1)
    try:
        return date.fromisoformat(lowered)
    except ValueError as exc:
        raise ToolInputInvalid("date must be YYYY-MM-DD, 'today' or 'tomorrow'") from exc


def parse_hhmm(value: str) -> time:
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except (ValueError, TypeError) as exc:
        raise ToolInputInvalid("time must be HH:MM (24h)") from exc


def parse_instant(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ToolInputInvalid("datetimes must include a UTC offset")
    return dt


def event_id_for(idempotency_key: str) -> str:
    """Deterministic Calendar event id (base32hex, lowercase): a retried insert of the same
    logical action hits 409 instead of creating a duplicate event."""
    digest = hashlib.sha256(idempotency_key.encode()).digest()
    return base64.b32hexencode(digest).decode().lower().rstrip("=")


def _event_time(ev: dict[str, Any], key: str) -> str | None:
    node = ev.get(key) or {}
    return node.get("dateTime") or node.get("date")


def _attendee_emails(ev: dict[str, Any]) -> list[str]:
    return sorted({(a.get("email") or "").lower() for a in ev.get("attendees", []) or [] if a.get("email")})


def _summarize_event(ev: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": ev.get("id"),
        "summary": clean_text(ev.get("summary") or "", max_chars=300),
        "start": _event_time(ev, "start"),
        "end": _event_time(ev, "end"),
        "status": ev.get("status"),
        "location": clean_text(ev.get("location") or "", max_chars=200) or None,
        "attendees": _attendee_emails(ev),
        "organizer": (ev.get("organizer") or {}).get("email"),
        "html_link": ev.get("htmlLink"),
    }


def _same_instant(a: Any, b: Any) -> bool:
    try:
        return parse_instant(str(a)) == parse_instant(str(b))
    except (ValueError, ToolInputInvalid):
        return a == b


# ---------------------------------------------------------------------------- list events
class ListEventsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: str | None = Field(default=None, description="YYYY-MM-DD, 'today' or 'tomorrow' (user's timezone)")
    time_min: str | None = Field(default=None, description="ISO-8601 with offset (alternative to date)")
    time_max: str | None = None
    calendar_id: str = Field(default="primary", max_length=300)
    query: str | None = Field(default=None, max_length=200)
    max_results: int = Field(default=25, ge=1, le=100)

    @model_validator(mode="after")
    def _window(self) -> ListEventsIn:
        if self.date is None and not (self.time_min and self.time_max):
            raise ValueError("provide either date or both time_min and time_max")
        return self


class EventOut(BaseModel):
    id: str | None
    summary: str
    start: str | None
    end: str | None
    status: str | None = None
    location: str | None = None
    attendees: list[str] = Field(default_factory=list)
    organizer: str | None = None
    html_link: str | None = None


class ListEventsOut(BaseModel):
    events: list[EventOut]
    time_min: str
    time_max: str
    timezone: str


class ListEventsTool(Tool[ListEventsIn, ListEventsOut]):
    input_model = ListEventsIn
    output_model = ListEventsOut
    spec = ToolSpec(
        name="calendar.list_events", description="List calendar events in a time window", category="calendar",
        provider="google", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW,
        required_scopes=READ_SCOPES, timeout_seconds=20, output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
        verification_method=VerificationMethod.OUTPUT_SCHEMA,
    )

    async def execute(self, tctx: ToolContext, args: ListEventsIn) -> ToolResult:
        tz = resolve_timezone(tctx.timezone)
        if args.date:
            day = resolve_date(args.date, tctx.timezone)
            start = datetime.combine(day, time(0, 0), tz)
            time_min, time_max = start.isoformat(), (start + timedelta(days=1)).isoformat()
        else:
            time_min, time_max = str(args.time_min), str(args.time_max)
        g = await tctx.services.google(tctx, READ_SCOPES)
        items = await g.calendar.list_events(calendar_id=args.calendar_id, time_min=time_min, time_max=time_max,
                                             max_results=args.max_results, query=args.query)
        events = [_summarize_event(e) for e in items if e.get("status") != "cancelled"]
        out = ListEventsOut(events=[EventOut(**e) for e in events], time_min=time_min, time_max=time_max,
                            timezone=str(tz))
        return ToolResult(output=out.model_dump(), summary=f"Read {len(events)} calendar event(s)",
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)


# ---------------------------------------------------------------------------- free slots
class FindSlotsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: str = Field(description="YYYY-MM-DD, 'today' or 'tomorrow' in the user's timezone")
    duration_minutes: int = Field(ge=5, le=480)
    earliest_time: str = Field(default="09:00", description="HH:MM local time; slots start at or after this")
    latest_time: str = Field(default="18:00", description="HH:MM local time; slots end at or before this")
    calendar_ids: list[str] = Field(default_factory=lambda: ["primary"], max_length=10)
    granularity_minutes: int = Field(default=15, ge=5, le=60)
    max_slots: int = Field(default=5, ge=1, le=20)
    require_at_least_one: bool = True


class Slot(BaseModel):
    start: str
    end: str


class FindSlotsOut(BaseModel):
    slots: list[Slot]
    date: str
    timezone: str
    window_start: str
    window_end: str
    busy_count: int


def compute_free_slots(window_start: datetime, window_end: datetime, busy: list[tuple[datetime, datetime]],
                       duration: timedelta, granularity: timedelta, max_slots: int) -> list[tuple[datetime, datetime]]:
    """Deterministic slot search: walk the window at ``granularity`` and keep candidates
    that overlap no busy interval. Pure function, unit-tested."""
    slots: list[tuple[datetime, datetime]] = []
    busy = sorted(busy)
    # align the first candidate to the granularity grid
    minutes = window_start.minute % int(granularity.total_seconds() // 60)
    cursor = window_start if minutes == 0 and window_start.second == 0 else (
        window_start.replace(second=0, microsecond=0) + timedelta(minutes=int(granularity.total_seconds() // 60)
                                                                  - minutes))
    while cursor + duration <= window_end and len(slots) < max_slots:
        end = cursor + duration
        if all(end <= b_start or cursor >= b_end for b_start, b_end in busy):
            slots.append((cursor, end))
            cursor = end
            continue
        cursor += granularity
    return slots


class FindFreeSlotsTool(Tool[FindSlotsIn, FindSlotsOut]):
    input_model = FindSlotsIn
    output_model = FindSlotsOut
    spec = ToolSpec(
        name="calendar.find_free_slots",
        description="Find free time slots of a given duration on a day (deterministic free/busy computation)",
        category="calendar", provider="google", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW,
        required_scopes=READ_SCOPES, timeout_seconds=20,
    )

    async def execute(self, tctx: ToolContext, args: FindSlotsIn) -> ToolResult:
        tz = resolve_timezone(tctx.timezone)
        day = resolve_date(args.date, tctx.timezone)
        earliest, latest = parse_hhmm(args.earliest_time), parse_hhmm(args.latest_time)
        window_start = datetime.combine(day, earliest, tz)
        window_end = datetime.combine(day, latest, tz)
        if window_end <= window_start:
            raise ToolInputInvalid("latest_time must be after earliest_time")
        now = datetime.now(tz)
        if window_end <= now:
            raise NeedsUserInput(f"The requested window on {day.isoformat()} is already in the past.")
        effective_start = max(window_start, now) if day == now.date() else window_start
        g = await tctx.services.google(tctx, READ_SCOPES)
        busy_map = await g.calendar.freebusy(time_min=window_start.isoformat(), time_max=window_end.isoformat(),
                                             timezone=str(tz), calendar_ids=args.calendar_ids)
        busy = [(parse_instant(b["start"]).astimezone(tz), parse_instant(b["end"]).astimezone(tz))
                for intervals in busy_map.values() for b in intervals]
        slots = compute_free_slots(effective_start, window_end, busy, timedelta(minutes=args.duration_minutes),
                                   timedelta(minutes=args.granularity_minutes), args.max_slots)
        if not slots and args.require_at_least_one:
            raise NeedsUserInput(
                f"No free {args.duration_minutes}-minute slot between {args.earliest_time} and "
                f"{args.latest_time} on {day.isoformat()}. Which other time or day should I use?")
        out = FindSlotsOut(slots=[Slot(start=s.isoformat(), end=e.isoformat()) for s, e in slots],
                           date=day.isoformat(), timezone=str(tz), window_start=window_start.isoformat(),
                           window_end=window_end.isoformat(), busy_count=len(busy))
        return ToolResult(output=out.model_dump(),
                          summary=f"Found {len(slots)} free {args.duration_minutes}-minute slot(s) on {day}")


# ---------------------------------------------------------------------------- create event
class CreateEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=300)
    start: str = Field(description="ISO-8601 datetime with UTC offset")
    end: str = Field(description="ISO-8601 datetime with UTC offset")
    attendees: list[EmailStr] = Field(default_factory=list, max_length=50)
    description: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=500)
    calendar_id: str = Field(default="primary", max_length=300)
    send_updates: str = Field(default="all", pattern="^(all|externalOnly|none)$")

    @field_validator("start", "end")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            parse_instant(v)
        except (ValueError, ToolInputInvalid) as exc:
            raise ValueError("must be ISO-8601 with a UTC offset") from exc
        return v

    @model_validator(mode="after")
    def _order(self) -> CreateEventIn:
        start, end = parse_instant(self.start), parse_instant(self.end)
        if end <= start:
            raise ValueError("end must be after start")
        if end - start > timedelta(hours=24):
            raise ValueError("events longer than 24h are not supported by this tool")
        return self


class CreateEventOut(BaseModel):
    event_id: str
    html_link: str | None = None
    summary: str
    start: str
    end: str
    attendees: list[str]
    status: str | None = None
    already_existed: bool = False


def _external_domains(emails: list[str], policy: OrganizationPolicy) -> list[str]:
    internal = {d.lower() for d in policy.internal_email_domains}
    return sorted({e.split("@")[-1].lower() for e in emails if e.split("@")[-1].lower() not in internal})


class CreateEventTool(Tool[CreateEventIn, CreateEventOut]):
    input_model = CreateEventIn
    output_model = CreateEventOut
    spec = ToolSpec(
        name="calendar.create_event", description="Create a calendar event (optionally inviting attendees)",
        category="calendar", provider="google", permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.MEDIUM,
        required_scopes=WRITE_SCOPES, supports_idempotency=True, idempotency_strategy=IdempotencyStrategy.NATIVE_KEY,
        timeout_seconds=20, retry_policy=RetryPolicy(max_attempts=3), parallel_safe=False,
        verification_method=VerificationMethod.READ_BACK,
    )

    def assess(self, args: CreateEventIn, policy: OrganizationPolicy) -> RiskAssessment:
        reasons: list[str] = []
        risk, approval = RiskLevel.MEDIUM, False
        if args.attendees:
            approval = True
            reasons.append("sends invitations to other people")
            if _external_domains([str(a) for a in args.attendees], policy):
                risk = RiskLevel.HIGH
                reasons.append("attendees outside the organization")
        return RiskAssessment(permission_level=PermissionLevel.WRITE, risk_level=risk, requires_approval=approval,
                              reasons=reasons)

    def describe(self, args: CreateEventIn) -> str:
        who = f" with {', '.join(str(a) for a in args.attendees)}" if args.attendees else ""
        return f"Create calendar event “{args.summary}” from {args.start} to {args.end}{who}"

    def target(self, args: CreateEventIn) -> str | None:
        return f"calendar:{args.calendar_id}"

    def _body(self, tctx: ToolContext, args: CreateEventIn) -> dict[str, Any]:
        body: dict[str, Any] = {
            "id": event_id_for(tctx.idempotency_key),
            "summary": args.summary,
            "start": {"dateTime": args.start},
            "end": {"dateTime": args.end},
            "attendees": [{"email": str(a)} for a in args.attendees],
            "extendedProperties": {"private": {"agentos_task": str(tctx.task_id),
                                               "agentos_step": tctx.step_key}},
        }
        if args.description:
            body["description"] = args.description
        if args.location:
            body["location"] = args.location
        return body

    @staticmethod
    def _out(ev: dict[str, Any], *, existed: bool) -> CreateEventOut:
        s = _summarize_event(ev)
        return CreateEventOut(event_id=str(ev.get("id")), html_link=ev.get("htmlLink"), summary=s["summary"],
                              start=s["start"] or "", end=s["end"] or "", attendees=s["attendees"],
                              status=ev.get("status"), already_existed=existed)

    async def execute(self, tctx: ToolContext, args: CreateEventIn) -> ToolResult:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        body = self._body(tctx, args)
        send_updates = args.send_updates if args.attendees else "none"
        try:
            ev = await g.calendar.insert_event(calendar_id=args.calendar_id, body=body, send_updates=send_updates)
            existed = False
        except IntegrationConflict:
            # Same deterministic id already exists: a previous attempt succeeded. Read it back.
            ev = await g.calendar.get_event(calendar_id=args.calendar_id, event_id=body["id"])
            existed = True
        out = self._out(ev, existed=existed)
        return ToolResult(output=out.model_dump(), external_ref=out.event_id,
                          summary=f"Created calendar event “{out.summary}” at {out.start}"
                          + (" (already existed from a previous attempt)" if existed else ""))

    async def verify(self, tctx: ToolContext, args: CreateEventIn, result: ToolResult) -> VerificationOutcome:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        event_id = str(result.output.get("event_id"))
        try:
            ev = await g.calendar.get_event(calendar_id=args.calendar_id, event_id=event_id)
        except IntegrationNotFound:
            return VerificationOutcome.failed_with(
                VerificationMethod.READ_BACK, [Difference(field="event", expected="exists", observed="not found")],
                retryable=True, expected={"event_id": event_id})
        observed = {"summary": ev.get("summary"), "start": _event_time(ev, "start"), "end": _event_time(ev, "end"),
                    "attendees": _attendee_emails(ev), "status": ev.get("status")}
        expected = {"summary": args.summary, "start": args.start, "end": args.end,
                    "attendees": sorted({str(a).lower() for a in args.attendees}), "status": "confirmed"}
        diffs = compare_fields(expected, observed, normalizers={
            "start": lambda v: parse_instant(str(v)) if v else None,
            "end": lambda v: parse_instant(str(v)) if v else None,
        })
        evidence = {"event_id": event_id, "html_link": ev.get("htmlLink"), "etag": ev.get("etag")}
        if diffs:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK, diffs, expected=expected,
                                                   observed=observed, evidence=evidence)
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, expected=expected, observed=observed,
                                               evidence=evidence)

    async def reconcile(self, tctx: ToolContext, args: CreateEventIn) -> ReconcileOutcome:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        event_id = event_id_for(tctx.idempotency_key)
        try:
            ev = await g.calendar.get_event(calendar_id=args.calendar_id, event_id=event_id)
        except IntegrationNotFound:
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"event_id": event_id})
        if ev.get("status") == "cancelled":
            return ReconcileOutcome(status=ReconcileStatus.UNKNOWN,
                                    evidence={"event_id": event_id, "reason": "event exists but is cancelled"})
        out = self._out(ev, existed=True)
        return ReconcileOutcome(status=ReconcileStatus.FOUND, evidence={"event_id": event_id},
                                result=ToolResult(output=out.model_dump(), external_ref=out.event_id,
                                                  summary=f"Confirmed calendar event “{out.summary}” exists"))


# ---------------------------------------------------------------------------- update event
class UpdateEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=1, max_length=1024)
    calendar_id: str = Field(default="primary", max_length=300)
    summary: str | None = Field(default=None, max_length=300)
    start: str | None = None
    end: str | None = None
    description: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=500)
    send_updates: str = Field(default="all", pattern="^(all|externalOnly|none)$")

    @model_validator(mode="after")
    def _something(self) -> UpdateEventIn:
        if not any([self.summary, self.start, self.end, self.description, self.location]):
            raise ValueError("nothing to update")
        if (self.start is None) != (self.end is None):
            raise ValueError("start and end must be changed together")
        if self.start and self.end and parse_instant(self.end) <= parse_instant(self.start):
            raise ValueError("end must be after start")
        return self

    def patch(self) -> dict[str, Any]:
        body: dict[str, Any] = {}
        for key in ("summary", "description", "location"):
            if getattr(self, key) is not None:
                body[key] = getattr(self, key)
        if self.start and self.end:
            body["start"] = {"dateTime": self.start}
            body["end"] = {"dateTime": self.end}
        return body


class UpdateEventOut(BaseModel):
    event_id: str
    summary: str
    start: str | None
    end: str | None


class UpdateEventTool(Tool[UpdateEventIn, UpdateEventOut]):
    input_model = UpdateEventIn
    output_model = UpdateEventOut
    spec = ToolSpec(
        name="calendar.update_event", description="Modify an existing calendar event (title/time/description)",
        category="calendar", provider="google", permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.MEDIUM,
        required_scopes=WRITE_SCOPES, requires_approval=True, idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP,
        timeout_seconds=20, parallel_safe=False, verification_method=VerificationMethod.READ_BACK,
    )

    def describe(self, args: UpdateEventIn) -> str:
        return f"Update calendar event {args.event_id}: {', '.join(sorted(args.patch()))}"

    async def execute(self, tctx: ToolContext, args: UpdateEventIn) -> ToolResult:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        ev = await g.calendar.patch_event(calendar_id=args.calendar_id, event_id=args.event_id, body=args.patch(),
                                          send_updates=args.send_updates)
        s = _summarize_event(ev)
        out = UpdateEventOut(event_id=args.event_id, summary=s["summary"], start=s["start"], end=s["end"])
        return ToolResult(output=out.model_dump(), external_ref=args.event_id,
                          summary=f"Updated calendar event “{out.summary}”")

    async def _matches(self, tctx: ToolContext, args: UpdateEventIn) -> tuple[list[Difference], dict[str, Any]]:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        ev = await g.calendar.get_event(calendar_id=args.calendar_id, event_id=args.event_id)
        expected = {k: v for k, v in {"summary": args.summary, "start": args.start, "end": args.end,
                                      "description": args.description, "location": args.location}.items()
                    if v is not None}
        observed = {"summary": ev.get("summary"), "start": _event_time(ev, "start"), "end": _event_time(ev, "end"),
                    "description": ev.get("description"), "location": ev.get("location")}
        diffs = compare_fields(expected, observed, normalizers={
            "start": lambda v: parse_instant(str(v)) if v else None,
            "end": lambda v: parse_instant(str(v)) if v else None})
        return diffs, observed

    async def verify(self, tctx: ToolContext, args: UpdateEventIn, result: ToolResult) -> VerificationOutcome:
        diffs, observed = await self._matches(tctx, args)
        if diffs:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK, diffs, observed=observed)
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, observed=observed,
                                               evidence={"event_id": args.event_id})

    async def reconcile(self, tctx: ToolContext, args: UpdateEventIn) -> ReconcileOutcome:
        diffs, observed = await self._matches(tctx, args)
        if diffs:
            # PATCH with the same body is idempotent, so "not applied" is safe to retry.
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"differences": len(diffs)})
        out = UpdateEventOut(event_id=args.event_id, summary=str(observed.get("summary") or ""),
                             start=observed.get("start"), end=observed.get("end"))
        return ReconcileOutcome(status=ReconcileStatus.FOUND, result=ToolResult(
            output=out.model_dump(), external_ref=args.event_id, summary="Confirmed event update was applied"))


# ---------------------------------------------------------------------------- cancel event
class CancelEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=1, max_length=1024)
    calendar_id: str = Field(default="primary", max_length=300)
    send_updates: str = Field(default="all", pattern="^(all|externalOnly|none)$")


class CancelEventOut(BaseModel):
    event_id: str
    cancelled: bool


class CancelEventTool(Tool[CancelEventIn, CancelEventOut]):
    input_model = CancelEventIn
    output_model = CancelEventOut
    spec = ToolSpec(
        name="calendar.cancel_event", description="Cancel (delete) a calendar event and notify attendees",
        category="calendar", provider="google", permission_level=PermissionLevel.HIGH_RISK_WRITE,
        risk_level=RiskLevel.HIGH, required_scopes=WRITE_SCOPES, requires_approval=True,
        idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP, timeout_seconds=20,
        retry_policy=RetryPolicy(max_attempts=2), parallel_safe=False,
        verification_method=VerificationMethod.READ_BACK,
    )

    def describe(self, args: CancelEventIn) -> str:
        return f"Cancel calendar event {args.event_id} (attendees notified: {args.send_updates})"

    async def execute(self, tctx: ToolContext, args: CancelEventIn) -> ToolResult:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        try:
            await g.calendar.delete_event(calendar_id=args.calendar_id, event_id=args.event_id,
                                          send_updates=args.send_updates)
        except IntegrationNotFound:
            pass  # already deleted (410/404): the desired end state holds; verification confirms
        return ToolResult(output=CancelEventOut(event_id=args.event_id, cancelled=True).model_dump(),
                          external_ref=args.event_id, summary=f"Cancelled calendar event {args.event_id}")

    async def _is_cancelled(self, tctx: ToolContext, args: CancelEventIn) -> tuple[bool, str]:
        g = await tctx.services.google(tctx, WRITE_SCOPES)
        try:
            ev = await g.calendar.get_event(calendar_id=args.calendar_id, event_id=args.event_id)
        except IntegrationNotFound:
            return True, "not_found"
        return ev.get("status") == "cancelled", str(ev.get("status"))

    async def verify(self, tctx: ToolContext, args: CancelEventIn, result: ToolResult) -> VerificationOutcome:
        cancelled, observed = await self._is_cancelled(tctx, args)
        if not cancelled:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK,
                                                   [Difference(field="status", expected="cancelled",
                                                               observed=observed)], retryable=True)
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, observed={"status": observed},
                                               evidence={"event_id": args.event_id})

    async def reconcile(self, tctx: ToolContext, args: CancelEventIn) -> ReconcileOutcome:
        cancelled, observed = await self._is_cancelled(tctx, args)
        if cancelled:
            return ReconcileOutcome(status=ReconcileStatus.FOUND, result=ToolResult(
                output=CancelEventOut(event_id=args.event_id, cancelled=True).model_dump(),
                external_ref=args.event_id, summary="Confirmed event is cancelled"))
        return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"status": observed})


TOOLS: list[Tool[Any, Any]] = [ListEventsTool(), FindFreeSlotsTool(), CreateEventTool(), UpdateEventTool(),
                               CancelEventTool()]
