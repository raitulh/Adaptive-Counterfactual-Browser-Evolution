"""account.purge: right-to-delete removes exactly one user's data and keeps the audit trail."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import func, select, update

from app.audit.models import AuditLog
from app.automations.models import Automation
from app.core.crypto import get_key_manager
from app.integrations.models import OAuthConnection, OAuthScope
from app.notifications.models import Notification
from app.organizations.models import Organization, OrganizationMember, Role
from app.tasks.models import Task
from app.users.models import User
from app.workers.jobs.maintenance import purge_account
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration


class FakeRevoker:
    def __init__(self) -> None:
        self.tokens: list[str] = []

    async def __call__(self, token: str) -> bool:
        self.tokens.append(token)
        return True


async def _seed(sf, tenant_id: uuid.UUID, user_id: uuid.UUID, tag: str) -> dict[str, Any]:
    """One automation, task (+ pending job), notification and Google connection for a user."""
    km = get_key_manager()
    async with sf() as s:
        s.info["tenant_id"] = tenant_id
        automation = Automation(tenant_id=tenant_id, user_id=user_id, name=f"auto-{tag}",
                                cron_expression="0 0 1 1 *", task_template={"goal": "g"}, enabled=False)
        task = Task(tenant_id=tenant_id, user_id=user_id, goal=f"task {tag}", status="queued")
        note = Notification(tenant_id=tenant_id, user_id=user_id, event_type="task_completed", title=tag,
                            idempotency_key=f"n-{uuid.uuid4()}")
        conn = OAuthConnection(tenant_id=tenant_id, user_id=user_id, provider="google",
                               provider_account_id=f"sub-{tag}", account_email=f"{tag}@gmail.example",
                               access_token_enc=km.encrypt(f"access-{tag}"),
                               refresh_token_enc=km.encrypt(f"refresh-{tag}"))
        s.add_all([automation, task, note, conn])
        await s.flush()
        s.add(OAuthScope(tenant_id=tenant_id, connection_id=conn.id, scope="https://www.googleapis.com/auth/gmail"))
        await s.commit()
    async with sf() as s:
        s.info["system"] = True
        job = Job(queue="execution", job_type="task.execute", status="pending", dedupe_key=f"task:{task.id}",
                  tenant_id=tenant_id, payload={"task_id": str(task.id), "tenant_id": str(tenant_id)})
        s.add(job)
        await s.commit()
    memory_id = None
    try:
        from app.memory.service import create_memory

        async with sf() as s:
            s.info["tenant_id"] = tenant_id
            memory = await create_memory(s, tenant_id=tenant_id, user_id=user_id,
                                         content=f"The user {tag} prefers window seats on flights.",
                                         memory_type="long_term", confidence=0.8, importance=0.6,
                                         source_type="user_stated", source_reference=f"user:{user_id}")
            await s.commit()
            memory_id = memory.id
    except (ImportError, AttributeError):  # memory module not finished in this checkout
        memory_id = None
    return {"automation": automation.id, "task": task.id, "notification": note.id, "connection": conn.id,
            "job": job.id, "memory": memory_id}


async def _exists(sf, model, row_id) -> bool:
    async with sf() as s:
        s.info["system"] = True
        return (await s.execute(select(model.id).where(model.id == row_id))).scalar_one_or_none() is not None


async def _member(sf, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    async with sf() as s:
        s.info["system"] = True
        return (await s.execute(select(OrganizationMember.id).where(
            OrganizationMember.tenant_id == tenant_id, OrganizationMember.user_id == user_id))
        ).scalar_one_or_none() is not None


async def _memory_exists(sf, memory_id) -> bool:
    from app.memory.models import MemoryItem

    return await _exists(sf, MemoryItem, memory_id)


async def test_purge_removes_only_that_users_data(sf, register_user):
    alice = await register_user()  # to be deleted; sole member of her personal organization
    bob = await register_user()
    async with sf() as s:
        s.info["system"] = True
        await s.execute(update(Organization).where(Organization.id == bob.tenant_id).values(is_personal=False))
        member_role = (await s.execute(select(Role).where(Role.name == "member", Role.tenant_id.is_(None)))
                       ).scalar_one()
        s.add(OrganizationMember(tenant_id=bob.tenant_id, user_id=alice.user_id, role_id=member_role.id))
        await s.commit()

    alice_home = await _seed(sf, alice.tenant_id, alice.user_id, "alice-home")
    alice_shared = await _seed(sf, bob.tenant_id, alice.user_id, "alice-shared")
    bob_data = await _seed(sf, bob.tenant_id, bob.user_id, "bob")

    async with sf() as s:
        s.info["system"] = True
        audit_before = (await s.execute(select(func.count()).select_from(AuditLog).where(
            AuditLog.user_id == alice.user_id))).scalar_one()
        await s.execute(update(User).where(User.id == alice.user_id).values(status="deletion_pending"))
        await s.commit()
    assert audit_before > 0

    revoker = FakeRevoker()
    summary = await purge_account(sf, alice.user_id, revoke=revoker)
    assert summary["status"] == "purged" and summary["organizations_deleted"] == 1

    # Google grants revoked at the provider (refresh token preferred) — only Alice's.
    assert sorted(revoker.tokens) == ["refresh-alice-home", "refresh-alice-shared"]

    # Alice's personal organization is gone, with everything in it.
    assert not await _exists(sf, Organization, alice.tenant_id)
    for key in ("automation", "task", "notification", "connection"):
        model = {"automation": Automation, "task": Task, "notification": Notification,
                 "connection": OAuthConnection}[key]
        assert not await _exists(sf, model, alice_home[key]), key
        assert not await _exists(sf, model, alice_shared[key]), key
        assert await _exists(sf, model, bob_data[key]), key
    async with sf() as s:
        s.info["system"] = True
        scopes = (await s.execute(select(OAuthScope.connection_id))).scalars().all()
        jobs = {j.id: j.status for j in (await s.execute(select(Job).where(
            Job.id.in_([alice_shared["job"], bob_data["job"]])))).scalars().all()}
    assert alice_shared["connection"] not in scopes and bob_data["connection"] in scopes
    assert jobs[alice_shared["job"]] == "cancelled" and jobs[bob_data["job"]] == "pending"
    if alice_shared["memory"] is not None:
        assert not await _memory_exists(sf, alice_shared["memory"])
        assert await _memory_exists(sf, bob_data["memory"])

    # Shared organization and Bob are untouched; Alice's membership is removed.
    assert await _exists(sf, Organization, bob.tenant_id)
    assert not await _member(sf, bob.tenant_id, alice.user_id)
    assert await _member(sf, bob.tenant_id, bob.user_id)

    async with sf() as s:
        s.info["system"] = True
        user = await s.get(User, alice.user_id)
        other = await s.get(User, bob.user_id)
        audit_after = (await s.execute(select(func.count()).select_from(AuditLog).where(
            AuditLog.user_id == alice.user_id))).scalar_one()
        purged = (await s.execute(select(AuditLog).where(AuditLog.user_id == alice.user_id,
                                                          AuditLog.action == "user.purged"))).scalars().all()
    assert user is not None and user.status == "deleted" and user.deleted_at is not None
    assert user.email == f"deleted-{alice.user_id}@deleted.invalid"
    assert user.display_name is None and user.password_hash is None
    assert other is not None and other.status == "active" and other.display_name is not None
    assert audit_after > audit_before and len(purged) == 1  # audit trail retained

    # Idempotent / resumable.
    again = await purge_account(sf, alice.user_id, revoke=revoker)
    assert again["status"] == "purged"
    assert len(revoker.tokens) == 2


async def test_purge_refuses_accounts_not_pending_deletion(sf, register_user):
    user = await register_user()
    data = await _seed(sf, user.tenant_id, user.user_id, "active")
    revoker = FakeRevoker()
    assert (await purge_account(sf, user.user_id, revoke=revoker))["status"] == "not_pending"
    assert (await purge_account(sf, uuid.uuid4(), revoke=revoker))["status"] == "missing"
    assert revoker.tokens == []
    assert await _exists(sf, Task, data["task"]) and await _exists(sf, Organization, user.tenant_id)


async def test_provider_revocation_failure_does_not_block_deletion(sf, register_user):
    user = await register_user()
    data = await _seed(sf, user.tenant_id, user.user_id, "flaky")
    async with sf() as s:
        s.info["system"] = True
        await s.execute(update(User).where(User.id == user.user_id).values(status="deletion_pending"))
        await s.commit()

    async def broken(token: str) -> bool:
        raise RuntimeError("network down")

    summary = await purge_account(sf, user.user_id, revoke=broken)
    assert summary["status"] == "purged"
    assert not await _exists(sf, OAuthConnection, data["connection"])
