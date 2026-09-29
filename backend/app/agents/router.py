from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select

from app.agents import service
from app.agents.models import Agent, AgentVersion
from app.agents.schemas import AgentCreate, AgentOut, AgentUpdate, AgentVersionIn, AgentVersionOut
from app.api.dependencies import DbSession, require
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.common.time import utcnow
from app.organizations.rbac import P
from app.users.models import User

router = APIRouter(prefix="/agents", tags=["agents"])


async def _versions_out(db: DbSession, versions: list[AgentVersion]) -> list[AgentVersionOut]:
    """Version payloads with the author's display name resolved (one query for the whole list)."""
    author_ids = {v.created_by for v in versions if v.created_by}
    names: dict[uuid.UUID, str] = {}
    if author_ids:
        rows = (await db.execute(select(User.id, User.display_name, User.email)
                                 .where(User.id.in_(author_ids)))).all()
        names = {uid: display or email for uid, display, email in rows}
    out = []
    for v in versions:
        item = AgentVersionOut.model_validate(v)
        item.created_by_name = names.get(v.created_by) if v.created_by else None
        out.append(item)
    return out


async def _out(db: DbSession, agent: Agent) -> AgentOut:
    out = AgentOut.model_validate(agent)
    if agent.current_version_id:
        version = await db.get(AgentVersion, agent.current_version_id)
        if version:
            out.current_version = AgentVersionOut.model_validate(version)
    return out


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED,
             summary="Create an agent with its first immutable version")
async def create_agent(body: AgentCreate, db: DbSession,
                       ctx: RequestContext = Depends(require(P.AGENTS_MANAGE))) -> AgentOut:
    return await _out(db, await service.create_agent(db, ctx, body))


@router.get("", response_model=Page[AgentOut], summary="List agents")
async def list_agents(db: DbSession, ctx: RequestContext = Depends(require(P.AGENTS_READ)),
                      cursor: str | None = None, limit: int = Query(50, ge=1, le=200)) -> Page[AgentOut]:
    lim = clamp_limit(limit)
    stmt = apply_keyset(select(Agent).where(Agent.deleted_at.is_(None)), Agent, cursor, lim)
    rows = list((await db.execute(stmt)).scalars().all())
    page = build_page(rows, lim, lambda a: a)
    return Page(items=[await _out(db, a) for a in page.items], next_cursor=page.next_cursor, has_more=page.has_more)


@router.get("/{agent_id}", response_model=AgentOut, summary="Get an agent")
async def get_agent(agent_id: uuid.UUID, db: DbSession,
                    ctx: RequestContext = Depends(require(P.AGENTS_READ))) -> AgentOut:
    return await _out(db, await service.get_agent(db, agent_id))


@router.patch("/{agent_id}", response_model=AgentOut, summary="Update agent metadata/status")
async def update_agent(agent_id: uuid.UUID, body: AgentUpdate, db: DbSession,
                       ctx: RequestContext = Depends(require(P.AGENTS_MANAGE))) -> AgentOut:
    agent = await service.get_agent(db, agent_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="agent.update", resource_type="agent",
                 resource_id=agent.id)
    await db.commit()
    return await _out(db, agent)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an agent (soft)")
async def delete_agent(agent_id: uuid.UUID, db: DbSession,
                       ctx: RequestContext = Depends(require(P.AGENTS_MANAGE))) -> Response:
    agent = await service.get_agent(db, agent_id)
    agent.deleted_at = utcnow()
    agent.status = "disabled"
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="agent.delete", resource_type="agent",
                 resource_id=agent.id)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{agent_id}/versions", response_model=AgentVersionOut, status_code=status.HTTP_201_CREATED,
             summary="Publish a new immutable agent version (becomes current)")
async def add_version(agent_id: uuid.UUID, body: AgentVersionIn, db: DbSession,
                      ctx: RequestContext = Depends(require(P.AGENTS_MANAGE))) -> AgentVersionOut:
    return (await _versions_out(db, [await service.add_version(db, ctx, agent_id, body)]))[0]


@router.get("/{agent_id}/versions", response_model=list[AgentVersionOut], summary="List agent versions")
async def list_versions(agent_id: uuid.UUID, db: DbSession,
                        ctx: RequestContext = Depends(require(P.AGENTS_READ))) -> list[AgentVersionOut]:
    await service.get_agent(db, agent_id)
    rows = (await db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent_id)
                             .order_by(AgentVersion.version_number.desc()))).scalars().all()
    return await _versions_out(db, list(rows))
