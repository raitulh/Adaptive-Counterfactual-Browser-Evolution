from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select, text

from app.audit.models import AuditLog
from app.memory.models import MemoryEmbedding, MemorySource

pytestmark = pytest.mark.integration

BASE = "/api/v1/memory"


async def _remember(client, user, content, **extra):
    resp = await client.post(BASE, json={"content": content, **extra}, headers=user.headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _audit_actions(db_session, user, resource_id: str) -> list[str]:
    rows = (await db_session.execute(
        select(AuditLog.action)
        .where(AuditLog.tenant_id == user.tenant_id, AuditLog.resource_id == resource_id)
        .order_by(AuditLog.created_at))).scalars().all()
    return list(rows)


async def test_create_is_user_stated_audited_and_deduplicated(memory_client, make_user, db_session):
    user = await make_user()
    body = await _remember(memory_client, user, "I prefer meetings after 10am.", memory_type="preference",
                           subject_key="pref:meeting_time")
    assert body["source_type"] == "user_stated"
    assert body["confidence"] == 1.0
    assert body["status"] == "active"
    assert body["freshness"] == "fresh"
    assert body["subject_key"] == "pref:meeting_time"
    assert body["source_reference"] == f"user:{user.user_id}"

    again = await _remember(memory_client, user, "i prefer meetings after 10am", memory_type="preference")
    assert again["id"] == body["id"]
    assert "memory.create" in await _audit_actions(db_session, user, body["id"])

    # A new user-stated value for the same subject supersedes the old one.
    newer = await _remember(memory_client, user, "I prefer meetings after 11am.", memory_type="preference",
                            subject_key="pref:meeting_time")
    listed = await memory_client.get(BASE, params={"status": "superseded"}, headers=user.headers)
    assert [m["id"] for m in listed.json()["items"]] == [body["id"]]
    assert listed.json()["items"][0]["superseded_by"] == newer["id"]


async def test_create_rejects_secrets_and_invalid_input(memory_client, make_user):
    user = await make_user()
    leaked = "my deploy key is sk-abcdefghijklmnopqrstuvwxyz12"
    resp = await memory_client.post(BASE, json={"content": leaked}, headers=user.headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "memory_contains_secret"
    for bad in ({"content": ""}, {"content": "x", "memory_type": "nonsense"},
                {"content": "x", "tenant_id": str(uuid.uuid4())},
                {"content": "x", "expires_at": "2000-01-01T00:00:00Z"}):
        resp = await memory_client.post(BASE, json=bad, headers=user.headers)
        assert resp.status_code == 422, bad
    listed = await memory_client.get(BASE, headers=user.headers)
    assert listed.json()["items"] == []


async def test_idempotency_key_replays_the_original_response(memory_client, make_user):
    user = await make_user()
    headers = {**user.headers, "Idempotency-Key": f"mem-{uuid.uuid4().hex}"}
    first = await memory_client.post(BASE, json={"content": "The office wifi network is called Orion."},
                                     headers=headers)
    second = await memory_client.post(BASE, json={"content": "The office wifi network is called Orion."},
                                      headers=headers)
    assert first.status_code == second.status_code == 201
    assert second.headers.get("Idempotent-Replayed") == "true"
    assert second.json()["id"] == first.json()["id"]
    reused = await memory_client.post(BASE, json={"content": "Something else entirely."}, headers=headers)
    assert reused.status_code == 422


async def test_list_is_own_only_filtered_and_cursor_paginated(memory_client, make_user):
    alice, bob = await make_user(), await make_user()
    ids = [(await _remember(memory_client, alice, f"Alice fact number {i} about gardening."))["id"]
           for i in range(3)]
    contact = await _remember(memory_client, alice, "Rahim's email is rahim@example.com",
                              memory_type="contact")
    await _remember(memory_client, bob, "Bob fact about sailing.")

    first = await memory_client.get(BASE, params={"limit": 2}, headers=alice.headers)
    assert first.status_code == 200
    page1 = first.json()
    assert page1["has_more"] is True
    second = await memory_client.get(BASE, params={"limit": 2, "cursor": page1["next_cursor"]},
                                     headers=alice.headers)
    page2 = second.json()
    seen = [m["id"] for m in page1["items"] + page2["items"]]
    assert sorted(seen) == sorted([*ids, contact["id"]])
    assert page2["has_more"] is False
    assert all("sailing" not in m["content"] for m in page1["items"] + page2["items"])

    only_contacts = await memory_client.get(BASE, params={"memory_type": "contact"}, headers=alice.headers)
    assert [m["id"] for m in only_contacts.json()["items"]] == [contact["id"]]
    bad_cursor = await memory_client.get(BASE, params={"cursor": "not-a-cursor"}, headers=alice.headers)
    assert bad_cursor.status_code == 422
    deleted_filter = await memory_client.get(BASE, params={"status": "deleted"}, headers=alice.headers)
    assert deleted_filter.status_code == 422


async def test_search_returns_ranked_own_memories_with_freshness(memory_client, make_user):
    alice, bob = await make_user(), await make_user()
    target = await _remember(memory_client, alice, "I like aisle seats on long flights.",
                             memory_type="preference")
    await _remember(memory_client, alice, "My sister lives in Chittagong.")
    await _remember(memory_client, bob, "I like aisle seats on long flights.", memory_type="preference")

    resp = await memory_client.post(f"{BASE}/search", json={"query": "which seat on flights?", "limit": 5},
                                    headers=alice.headers)
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert results[0]["id"] == target["id"]
    assert results[0]["freshness"] == "fresh"
    assert {"score", "confidence", "memory_type", "source_type", "last_verified_at"} <= set(results[0])
    bob_ids = {r["id"] for r in (await memory_client.post(
        f"{BASE}/search", json={"query": "aisle seats"}, headers=bob.headers)).json()["results"]}
    assert target["id"] not in bob_ids

    typed = await memory_client.post(f"{BASE}/search", json={"query": "flights", "memory_types": ["contact"]},
                                     headers=alice.headers)
    assert typed.json()["results"] == []
    invalid = await memory_client.post(f"{BASE}/search", json={"query": ""}, headers=alice.headers)
    assert invalid.status_code == 422


async def test_delete_is_owner_only_and_removes_derived_data(memory_client, make_user, db_session,
                                                             run_embed_job):
    owner, other = await make_user(), await make_user()
    created = await _remember(memory_client, owner, "The user's passport renewal is due in May.")
    memory_id = uuid.UUID(created["id"])
    await run_embed_job(owner.tenant_id, memory_id)
    assert await db_session.get(MemoryEmbedding, memory_id) is not None

    # Another user (other tenant) gets 404 for both delete and verify: existence is not revealed.
    assert (await memory_client.delete(f"{BASE}/{memory_id}", headers=other.headers)).status_code == 404
    assert (await memory_client.post(f"{BASE}/{memory_id}/verify", headers=other.headers)).status_code == 404

    resp = await memory_client.delete(f"{BASE}/{memory_id}", headers=owner.headers)
    assert resp.status_code == 204
    db_session.expire_all()
    assert await db_session.get(MemoryEmbedding, memory_id) is None
    sources = (await db_session.execute(select(MemorySource).where(MemorySource.memory_id == memory_id))
               ).scalars().all()
    assert sources == []
    assert (await memory_client.delete(f"{BASE}/{memory_id}", headers=owner.headers)).status_code == 404
    listed = await memory_client.get(BASE, headers=owner.headers)
    assert listed.json()["items"] == []
    assert await _audit_actions(db_session, owner, str(memory_id)) == ["memory.create", "memory.delete"]


async def test_verify_refreshes_and_resolves_conflicts(memory_client, make_user):
    user = await make_user()
    created = await _remember(memory_client, user, "The team standup is at 9:30.", importance=0.4)
    resp = await memory_client.post(f"{BASE}/{created['id']}/verify", headers=user.headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["freshness"] == "fresh"
    assert body["confidence"] >= 0.9
    verified_at = datetime.fromisoformat(body["last_verified_at"])
    assert verified_at >= datetime.fromisoformat(created["last_verified_at"])
    missing = await memory_client.post(f"{BASE}/{uuid.uuid4()}/verify", headers=user.headers)
    assert missing.status_code == 404


async def test_authentication_and_permissions_are_enforced(memory_client, make_user, db_session):
    assert (await memory_client.get(BASE)).status_code == 401
    assert (await memory_client.post(BASE, json={"content": "x y z"})).status_code == 401

    viewer = await make_user()
    await db_session.execute(text(
        "UPDATE organization_members SET role_id = (SELECT id FROM roles WHERE name = 'viewer' "
        "AND tenant_id IS NULL LIMIT 1) WHERE user_id = :u"), {"u": viewer.user_id})
    await db_session.commit()
    assert (await memory_client.get(BASE, headers=viewer.headers)).status_code == 200
    denied = await memory_client.post(BASE, json={"content": "Viewers cannot write memories."},
                                      headers=viewer.headers)
    assert denied.status_code == 403
    assert (await memory_client.delete(f"{BASE}/{uuid.uuid4()}", headers=viewer.headers)).status_code == 403
