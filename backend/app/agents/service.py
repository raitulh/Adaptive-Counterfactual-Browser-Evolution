from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.models import Agent, AgentVersion
from app.agents.schemas import (
    AgentCreate,
    AgentVersionIn,
    ExecutionLimits,
    MemoryPolicy,
    ModelPolicy,
    ResolvedAgent,
    ToolPolicy,
    VerificationPolicy,
)
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.core.exceptions import Conflict, NotFound, ValidationFailed
from app.tools.base import canonical_hash

BUILTIN_DEFAULT_LABEL = "builtin-default:v1"


def builtin_default() -> ResolvedAgent:
    return ResolvedAgent(agent_id=None, agent_version_id=None, label=BUILTIN_DEFAULT_LABEL, instructions="",
                         model_policy=ModelPolicy(), tool_policy=ToolPolicy(), memory_policy=MemoryPolicy(),
                         execution_limits=ExecutionLimits(), verification_policy=VerificationPolicy())


async def create_agent(session: AsyncSession, ctx: RequestContext, body: AgentCreate) -> Agent:
    exists = (await session.execute(select(Agent.id).where(Agent.name == body.name, Agent.deleted_at.is_(None))
                                    )).scalar_one_or_none()
    if exists:
        raise Conflict("An agent with this name already exists")
    agent = Agent(tenant_id=ctx.tenant_id, owner_id=ctx.user_id, name=body.name, description=body.description)
    session.add(agent)
    await session.flush()
    version = await _add_version(session, ctx, agent, body)
    agent.current_version_id = version.id
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="agent.create", resource_type="agent",
                 resource_id=agent.id)
    await session.commit()
    return agent


async def _add_version(session: AsyncSession, ctx: RequestContext, agent: Agent, body: AgentVersionIn
                       ) -> AgentVersion:
    number = (await session.execute(
        select(func.coalesce(func.max(AgentVersion.version_number), 0)).where(AgentVersion.agent_id == agent.id)
    )).scalar_one() + 1
    payload = body.model_dump(include=set(AgentVersionIn.model_fields))
    version = AgentVersion(tenant_id=ctx.tenant_id, agent_id=agent.id, version_number=number,
                           checksum=canonical_hash(payload), created_by=ctx.user_id, **payload)
    session.add(version)
    await session.flush()
    return version


async def add_version(session: AsyncSession, ctx: RequestContext, agent_id: uuid.UUID, body: AgentVersionIn
                      ) -> AgentVersion:
    agent = await get_agent(session, agent_id)
    version = await _add_version(session, ctx, agent, body)
    agent.current_version_id = version.id
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="agent.version.create",
                 resource_type="agent", resource_id=agent.id, metadata={"version": version.version_number})
    await session.commit()
    return version


async def get_agent(session: AsyncSession, agent_id: uuid.UUID) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.deleted_at is not None:
        raise NotFound("Agent not found")
    return agent


async def resolve_agent(session: AsyncSession, agent_id: uuid.UUID | None, version_id: uuid.UUID | None = None
                        ) -> ResolvedAgent:
    if agent_id is None:
        return builtin_default()
    agent = await get_agent(session, agent_id)
    if agent.status != "active":
        raise ValidationFailed("Agent is disabled")
    vid = version_id or agent.current_version_id
    version = await session.get(AgentVersion, vid) if vid else None
    if version is None or version.agent_id != agent.id:
        raise NotFound("Agent version not found")
    return ResolvedAgent(
        agent_id=agent.id, agent_version_id=version.id, label=f"{agent.name}:v{version.version_number}",
        instructions=version.instructions, model_policy=ModelPolicy.model_validate(version.model_policy),
        tool_policy=ToolPolicy.model_validate(version.tool_policy),
        memory_policy=MemoryPolicy.model_validate(version.memory_policy),
        execution_limits=ExecutionLimits.model_validate(version.execution_limits),
        verification_policy=VerificationPolicy.model_validate(version.verification_policy),
    )
