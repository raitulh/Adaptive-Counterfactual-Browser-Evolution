"""Contact resolution: turn a name into an e-mail address from *allowed sources only*.

Sources, in order: the user's saved contact memories, then Google Contacts
(People API, if the contacts scope was granted). The tool never guesses: zero
matches or an ambiguous match pauses the task and asks the user.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import PermissionLevel, RiskLevel
from app.core.exceptions import InsufficientScope, IntegrationNotConnected, NeedsUserInput
from app.integrations.google.oauth import CAPABILITY_SCOPES
from app.tools.base import Tool, ToolContext, ToolResult, ToolSpec

logger = logging.getLogger(__name__)
CONTACT_SCOPES = CAPABILITY_SCOPES["contacts.read"]
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


class LookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120, description="Person's name as the user wrote it")
    require_unique: bool = Field(default=True, description="Ask the user when zero or several matches exist")


class ContactMatch(BaseModel):
    name: str
    email: str
    source: str
    confidence: float


class LookupOut(BaseModel):
    query: str
    matches: list[ContactMatch]
    best: ContactMatch | None = None
    sources_checked: list[str]


def _normalize(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def _name_matches(query: str, candidate: str) -> bool:
    q, c = _normalize(query), _normalize(candidate)
    if not q or not c:
        return False
    return q == c or q in c.split(" ") or c.startswith(q + " ") or all(part in c.split(" ") for part in q.split(" "))


class ContactLookupTool(Tool[LookupIn, LookupOut]):
    input_model = LookupIn
    output_model = LookupOut
    spec = ToolSpec(
        name="contacts.lookup",
        description="Resolve a person's name to an e-mail address from the user's saved contacts or Google Contacts",
        category="contacts", provider="internal", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW,
        timeout_seconds=20,
    )

    async def execute(self, tctx: ToolContext, args: LookupIn) -> ToolResult:
        from app.memory.service import find_contacts

        matches: list[ContactMatch] = []
        checked: list[str] = []
        async with tctx.services.session_factory() as session:
            session.info["tenant_id"] = tctx.tenant_id
            for c in await find_contacts(session, tenant_id=tctx.tenant_id, user_id=tctx.user_id, name=args.name):
                if _EMAIL.match(c.email):
                    matches.append(ContactMatch(name=c.name, email=c.email.lower(), source="saved_contact",
                                                confidence=c.confidence))
        checked.append("saved_contacts")
        try:
            g = await tctx.services.google(tctx, CONTACT_SCOPES)
            people = await g.people.search_contacts(args.name, page_size=10)
            checked.append("google_contacts")
            for person in people:
                names = [n.get("displayName", "") for n in person.get("names", [])]
                if not any(_name_matches(args.name, n) for n in names):
                    continue
                for addr in person.get("emailAddresses", []):
                    value = str(addr.get("value", "")).strip()
                    if _EMAIL.match(value):
                        matches.append(ContactMatch(name=names[0] if names else args.name, email=value.lower(),
                                                    source="google_contacts", confidence=0.9))
        except (InsufficientScope, IntegrationNotConnected) as exc:
            logger.info("google contacts unavailable for lookup", extra={"reason": exc.code})

        by_email: dict[str, ContactMatch] = {}
        for m in matches:
            if m.email not in by_email or m.confidence > by_email[m.email].confidence:
                by_email[m.email] = m
        unique = sorted(by_email.values(), key=lambda m: -m.confidence)
        if args.require_unique and not unique:
            raise NeedsUserInput(f"I couldn't find an e-mail address for “{args.name}” in your contacts. "
                                 "What is their e-mail address?",
                                 details={"field": "email", "name": args.name, "sources_checked": checked})
        if args.require_unique and len(unique) > 1:
            options = ", ".join(f"{m.name} <{m.email}>" for m in unique[:5])
            raise NeedsUserInput(f"I found several contacts matching “{args.name}”: {options}. Which one?",
                                 details={"field": "email", "options": [m.email for m in unique[:5]]})
        out = LookupOut(query=args.name, matches=unique, best=unique[0] if len(unique) == 1 else None,
                        sources_checked=checked)
        summary = (f"Resolved “{args.name}” to {out.best.email} ({out.best.source})" if out.best
                   else f"Found {len(unique)} contact(s) for “{args.name}”")
        return ToolResult(output=out.model_dump(), summary=summary)


    def output_from_user_input(self, args: LookupIn, answer: str, details: dict[str, Any]) -> ToolResult | None:
        email = answer.strip().strip("<>").lower()
        if not _EMAIL.match(email):
            from app.core.exceptions import ValidationFailed

            raise ValidationFailed("Please provide a valid e-mail address", details={"field": "email"})
        match = ContactMatch(name=args.name, email=email, source="user_provided", confidence=1.0)
        out = LookupOut(query=args.name, matches=[match], best=match, sources_checked=["user"])
        return ToolResult(output=out.model_dump(), summary=f"Using {email} for “{args.name}” (provided by you)")


TOOLS: list[Tool[Any, Any]] = [ContactLookupTool()]
