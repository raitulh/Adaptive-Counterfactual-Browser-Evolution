"""Idempotent demo data for local development, created through the real services.

    python scripts/seed.py                    # create what is missing
    python scripts/seed.py --reset-password   # also give the demo user a new password

Creates (or leaves as is, when already present):

* the demo user ``demo@agentos.example.com`` with a generated password (printed ONCE,
  only when the user is created or the password is reset) — via ``auth.service.register``,
  which also creates the "AgentOS Demo" organization with the user as owner. The address
  uses the reserved ``example.com`` domain: the API's e-mail validation (deliberately)
  rejects special-use domains such as ``.local``;
* an agent "demo-assistant" with its first immutable version (``agents.service.create_agent``);
* an organization policy that treats the demo user's domain as the internal e-mail domain
  (``organizations.service.update_policy``; bumps the policy version only on change);
* a tool rule requiring approval for every ``gmail.send`` (audited like the API does).

Refuses to run when APP_ENV is production or staging. Requires migrated PostgreSQL
(the migrations seed the system roles and permissions).
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import string
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEMO_EMAIL = "demo@agentos.example.com"
DEMO_NAME = "Demo User"
DEMO_ORG = "AgentOS Demo"
DEMO_TIMEZONE = "UTC"
DEMO_AGENT = "demo-assistant"
RULE_PATTERN = "gmail.send"
RULE_EFFECT = "require_approval"
RULE_REASON = "Demo policy: a person confirms every outgoing e-mail, including internal ones."
AGENT_INSTRUCTIONS = (
    "You are the AgentOS demo assistant. You help with calendars, e-mail and documents. "
    "Prefer 30-minute meetings during working hours in the user's timezone. Always look up "
    "contacts instead of guessing addresses, and keep e-mails short and polite."
)


def generate_password(min_length: int) -> str:
    """A random password that satisfies the registration strength rules."""
    from app.auth.schemas import check_password_strength

    alphabet = string.ascii_letters + string.digits + "-_.!@#%"
    length = max(20, min_length)
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        try:
            check_password_strength(candidate)
        except ValueError:
            continue
        if any(c.isdigit() for c in candidate) and any(c.isupper() for c in candidate):
            return candidate


def say(message: str) -> None:
    print(message, flush=True)


async def seed(reset_password: bool) -> int:
    from sqlalchemy import select

    from app.agents import service as agents_service
    from app.agents.models import Agent
    from app.agents.schemas import AgentCreate, ExecutionLimits, ToolPolicy
    from app.audit import service as audit
    from app.audit.service import AuditCategory
    from app.auth import service as auth_service
    from app.auth.service import ClientInfo
    from app.common.context import RequestContext
    from app.core.config import get_settings
    from app.core.database import dispose_engine, get_session_factory, set_system_scope, set_tenant_scope
    from app.core.redis import close_redis
    from app.core.security import hash_password
    from app.organizations import repository as org_repo
    from app.organizations import service as org_service
    from app.tools.models import ToolPermission

    settings = get_settings()
    if settings.is_production:
        say(f"Refusing to seed demo data: APP_ENV={settings.app_env.value}. Seeding is for development only.")
        return 2

    sf = get_session_factory()
    password: str | None = None
    try:
        # ---------------------------------------------------------------- user + organization
        async with sf() as session:
            set_system_scope(session)
            email = DEMO_EMAIL
            user = await auth_service.get_user_by_email(session, email)
            if user is None:
                password = generate_password(settings.password_min_length)
                try:
                    await auth_service.register(
                        session, email=email, password=password, display_name=DEMO_NAME,
                        organization_name=DEMO_ORG, timezone=DEMO_TIMEZONE,
                        client=ClientInfo(ip="127.0.0.1", user_agent="agentos-seed", device_name="seed script"))
                except RuntimeError as exc:  # e.g. "system roles are not seeded; run migrations"
                    say(f"Cannot create the demo user: {exc}. Run `make migrate` first.")
                    return 1
                say(f"created user {email}")
            elif reset_password:
                password = generate_password(settings.password_min_length)
                user.password_hash = hash_password(password)
                user.failed_login_count = 0
                user.locked_until = None
                audit.record(session, category=AuditCategory.SECURITY, action="user.password_reset",
                             tenant_id=user.default_tenant_id, user_id=user.id, actor_type="system",
                             metadata={"source": "seed_script"})
                await session.commit()
                say(f"reset the password of {email}")
            else:
                say(f"user {email} already exists (password unchanged; use --reset-password)")

        async with sf() as session:
            set_system_scope(session)
            user = await auth_service.get_user_by_email(session, email)
            if user is None or user.default_tenant_id is None:
                say("The demo user has no organization; cannot continue.")
                return 1
            tenant_id = user.default_tenant_id
            membership = await org_repo.get_active_membership(session, user.id, tenant_id)
            if membership is None:
                say("The demo user is not an active member of its default organization; cannot continue.")
                return 1
            _, role, org = membership
            permissions = await org_repo.role_permissions(session, role.id)
            ctx = RequestContext(user_id=user.id, tenant_id=tenant_id, role=role.name, permissions=permissions,
                                 timezone=user.timezone, email=user.email, actor_type="system",
                                 ip="127.0.0.1", user_agent="agentos-seed")
            org_name = org.name
        internal_domain = email.rsplit("@", 1)[1]

        # ---------------------------------------------------------------- agent with a version
        async with sf() as session:
            set_tenant_scope(session, tenant_id)
            agent = (await session.execute(
                select(Agent).where(Agent.name == DEMO_AGENT, Agent.deleted_at.is_(None)))).scalar_one_or_none()
            if agent is None:
                agent = await agents_service.create_agent(session, ctx, AgentCreate(
                    name=DEMO_AGENT, description="Scheduling and e-mail assistant used by the local demo.",
                    instructions=AGENT_INSTRUCTIONS,
                    tool_policy=ToolPolicy(allowed=["*"], denied=["browser.*"]),
                    execution_limits=ExecutionLimits(max_steps=10, max_tool_calls=30)))
                say(f"created agent {DEMO_AGENT}")
            else:
                say(f"agent {DEMO_AGENT} already exists")
            agent_id, agent_version_id = agent.id, agent.current_version_id

        # ---------------------------------------------------------------- organization policy
        async with sf() as session:
            set_tenant_scope(session, tenant_id)
            policy, version = await org_service.get_policy(session, tenant_id)
            if internal_domain not in policy.internal_email_domains:
                updated = policy.model_copy(update={
                    "internal_email_domains": [*policy.internal_email_domains, internal_domain]})
                version = await org_service.update_policy(session, ctx, updated)
                say(f"organization policy updated (internal domain {internal_domain}); version {version}")
            else:
                say(f"organization policy already lists {internal_domain} (version {version})")

        # ---------------------------------------------------------------- tool rule
        async with sf() as session:
            set_tenant_scope(session, tenant_id)
            rule = (await session.execute(select(ToolPermission).where(
                ToolPermission.tool_pattern == RULE_PATTERN, ToolPermission.effect == RULE_EFFECT,
                ToolPermission.role.is_(None)))).scalars().first()
            if rule is None:
                rule = ToolPermission(tenant_id=tenant_id, tool_pattern=RULE_PATTERN, role=None, effect=RULE_EFFECT,
                                      reason=RULE_REASON, created_by=user.id)
                session.add(rule)
                audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="tool_policy.create",
                             resource_type="tool_permission",
                             metadata={"tool_pattern": RULE_PATTERN, "effect": RULE_EFFECT, "source": "seed_script"})
                await session.commit()
                say(f"created tool rule {RULE_PATTERN} -> {RULE_EFFECT}")
            else:
                say(f"tool rule {RULE_PATTERN} -> {RULE_EFFECT} already exists")
            rule_id = rule.id
    finally:
        await close_redis()
        await dispose_engine()

    say("")
    say("Demo data is ready:")
    say(f"  organization   {org_name} ({tenant_id})")
    say(f"  user           {email}")
    if password is not None:
        say(f"  password       {password}")
        say("                 (shown once; store it now or run with --reset-password later)")
    say(f"  agent          {DEMO_AGENT} ({agent_id}, version {agent_version_id})")
    say(f"  tool rule      {RULE_PATTERN} -> {RULE_EFFECT} ({rule_id})")
    say(f"Sign in with POST {settings.api_prefix}/auth/login")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create idempotent AgentOS demo data (development only)")
    parser.add_argument("--reset-password", action="store_true",
                        help="set and print a new password for the existing demo user")
    args = parser.parse_args(argv)
    return asyncio.run(seed(args.reset_password))


if __name__ == "__main__":
    sys.exit(main())
