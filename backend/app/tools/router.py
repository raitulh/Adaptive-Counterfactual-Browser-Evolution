from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.dependencies import Ctx, DbSession, require
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.core.exceptions import NotFound, ValidationFailed
from app.integrations import service as integrations
from app.integrations.schemas import ConnectGoogleResponse
from app.organizations.rbac import P
from app.permissions.service import PermissionService, load_policy_inputs
from app.agents.schemas import ToolPolicy
from app.tools.models import ToolPermission
from app.tools.registry import ToolResolver

router = APIRouter(prefix="/tools", tags=["tools"])


class ToolOut(BaseModel):
    name: str
    version: str
    description: str
    category: str
    provider: str
    permission_level: str
    risk_level: str
    requires_approval: bool
    required_scopes: list[str]
    verification_method: str
    output_trust: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    available_to_you: bool
    policy_reasons: list[str] = Field(default_factory=list)


class ToolConnectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["google"]
    capabilities: list[str] = Field(min_length=1)


class ToolRuleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_pattern: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9_.*]+$")
    role: str | None = Field(default=None, max_length=60)
    effect: Literal["deny", "require_approval", "allow"]
    reason: str | None = Field(default=None, max_length=500)


class ToolRuleOut(ToolRuleIn):
    model_config = ConfigDict(from_attributes=True, extra="ignore")
    id: uuid.UUID


@router.get("", response_model=list[ToolOut], summary="Tool catalogue with your effective permission for each")
async def list_tools(ctx: Ctx, db: DbSession) -> list[ToolOut]:
    ctx.require(P.TOOLS_READ)
    policy = await load_policy_inputs(db, ctx.tenant_id, ToolPolicy())
    engine = PermissionService()
    out = []
    for tool in await ToolResolver().available(db, ctx.tenant_id):
        spec = tool.spec
        decision = engine.evaluate(ctx, spec, policy)
        out.append(ToolOut(
            name=spec.name, version=spec.version, description=spec.description, category=spec.category,
            provider=spec.provider, permission_level=spec.permission_level.value, risk_level=spec.risk_level.value,
            requires_approval=decision.needs_approval, required_scopes=spec.required_scopes,
            verification_method=spec.verification_method, output_trust=spec.output_trust.value,
            input_schema=spec.input_schema, output_schema=spec.output_schema,
            available_to_you=decision.allowed, policy_reasons=decision.reasons))
    return sorted(out, key=lambda t: t.name)


@router.post("/connect", response_model=ConnectGoogleResponse,
             summary="Connect the account a tool provider needs (returns an OAuth authorization URL)")
async def connect(body: ToolConnectRequest,
                  ctx: RequestContext = Depends(require(P.INTEGRATIONS_MANAGE))) -> ConnectGoogleResponse:
    url, scopes = await integrations.start_google_connect(ctx, body.capabilities, None)
    return ConnectGoogleResponse(authorization_url=url, requested_scopes=scopes)


@router.get("/policies", response_model=list[ToolRuleOut], summary="Organization tool policy rules")
async def list_rules(ctx: Ctx, db: DbSession) -> list[ToolRuleOut]:
    ctx.require(P.TOOLS_READ)
    rows = (await db.execute(select(ToolPermission).order_by(ToolPermission.created_at))).scalars().all()
    return [ToolRuleOut.model_validate(r) for r in rows]


@router.post("/policies", response_model=ToolRuleOut, status_code=status.HTTP_201_CREATED,
             summary="Add an organization tool rule (deny / require_approval / allow)")
async def add_rule(body: ToolRuleIn, db: DbSession,
                   ctx: RequestContext = Depends(require(P.TOOLS_MANAGE))) -> ToolRuleOut:
    if body.effect == "allow" and body.tool_pattern in ("*", "*.*"):
        raise ValidationFailed("A blanket allow rule is not permitted; name the tools explicitly")
    rule = ToolPermission(tenant_id=ctx.tenant_id, tool_pattern=body.tool_pattern, role=body.role,
                          effect=body.effect, reason=body.reason, created_by=ctx.user_id)
    db.add(rule)
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="tool_policy.create",
                 resource_type="tool_permission", metadata=body.model_dump())
    await db.commit()
    return ToolRuleOut.model_validate(rule)


@router.delete("/policies/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove a tool rule")
async def delete_rule(rule_id: uuid.UUID, db: DbSession,
                      ctx: RequestContext = Depends(require(P.TOOLS_MANAGE))) -> Response:
    rule = await db.get(ToolPermission, rule_id)
    if rule is None:
        raise NotFound("Rule not found")
    await db.delete(rule)
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="tool_policy.delete",
                 resource_type="tool_permission", resource_id=rule_id)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
