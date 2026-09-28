"""MCP gateway security: tenant isolation, SSRF/egress, secret handling, RBAC."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from mcp_fakes import PUBLIC_URL, FakeMCPServer, tool_context
from mcp_gateway_helpers import (
    API,
    approve,
    audit_rows,
    available_names,
    create_server,
    patch_tool,
    ready_server,
    resolve,
    resolve_on_system_session,
    sync,
)
from sqlalchemy import select

from app.core.config import get_settings
from app.core.crypto import get_key_manager
from app.core.database import system_session, tenant_session
from app.core.exceptions import Forbidden, PolicyDenied
from app.mcp import service
from app.mcp.models import MCPServer, MCPTool
from app.mcp.schemas import MCPServerCreate
from app.tools.models import ToolCredential

pytestmark = pytest.mark.integration

SECRET = "Bearer sec-7f3a9c1e5b2d8f4a6c0e"
ECHO = "mcp.demo.echo"


# ---------------------------------------------------------------------------- tenant isolation
async def test_other_tenant_cannot_see_resolve_or_use_tools(api: httpx.AsyncClient, register_user: Any,
                                                            fake_mcp: FakeMCPServer) -> None:
    alice = await register_user()
    bob = await register_user()
    server, tools = await ready_server(api, alice)
    await patch_tool(api, alice, tools["echo"]["id"], enabled=True, permission_level="read")
    alice_adapter = await resolve(alice.tenant_id, ECHO)
    assert alice_adapter is not None

    # Bob sees nothing and cannot resolve Alice's tool, even from a system-scoped (worker) session.
    assert await resolve(bob.tenant_id, ECHO) is None
    assert await resolve_on_system_session(bob.tenant_id, ECHO) is None
    assert await available_names(bob.tenant_id) == []
    assert (await api.get(f"{API}/servers", headers=bob.headers)).json() == []
    for method, path in (("GET", f"/servers/{server['id']}"), ("GET", f"/servers/{server['id']}/tools"),
                         ("POST", f"/servers/{server['id']}/approve"),
                         ("POST", f"/servers/{server['id']}/disable"),
                         ("POST", f"/servers/{server['id']}/sync"), ("DELETE", f"/servers/{server['id']}")):
        resp = await api.request(method, f"{API}{path}", headers=bob.headers)
        assert resp.status_code == 404, (method, path, resp.text)
    await patch_tool(api, bob, tools["echo"]["id"], expect=404, enabled=True)

    # An adapter handed to another tenant refuses before any I/O.
    with pytest.raises(PolicyDenied):
        await alice_adapter.execute(tool_context(bob.tenant_id, bob.user_id),
                                    alice_adapter.parse_args({"text": "x"}))
    async with tenant_session(bob.tenant_id) as session:
        with pytest.raises(PolicyDenied):
            await service.load_call_endpoint(session, bob.tenant_id, uuid.UUID(tools["echo"]["id"]),
                                             tools["echo"]["schema_hash"])
    assert fake_mcp.calls == []

    # Bob may use the same server name; his tools are separate rows and start disabled.
    bob_server, bob_tools = await ready_server(api, bob)
    assert bob_server["id"] != server["id"]
    assert bob_tools["echo"]["id"] != tools["echo"]["id"]
    assert await resolve(bob.tenant_id, ECHO) is None
    alice_again = await resolve(alice.tenant_id, ECHO)
    assert alice_again is not None
    assert alice_again.binding.server_id == uuid.UUID(server["id"])  # type: ignore[attr-defined]

    # Alice's state is untouched by Bob's actions.
    alice_server = await api.get(f"{API}/servers/{server['id']}", headers=alice.headers)
    assert alice_server.json()["status"] == "approved"


async def test_tool_rows_are_invisible_across_tenant_scoped_sessions(api: httpx.AsyncClient,
                                                                      register_user: Any,
                                                                      fake_mcp: FakeMCPServer) -> None:
    alice = await register_user()
    bob = await register_user()
    await ready_server(api, alice)
    async with tenant_session(bob.tenant_id) as session:
        assert (await session.execute(select(MCPTool))).scalars().all() == []
        assert (await session.execute(select(MCPServer))).scalars().all() == []


# ---------------------------------------------------------------------------- SSRF / egress
@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1:8765/mcp",
    "http://localhost/mcp",
    "http://10.0.0.7/mcp",
    "http://192.168.1.20/mcp",
    "http://[::1]/mcp",
    "http://[fe80::1]/mcp",
    "http://100.64.1.1/mcp",
    "http://service.internal/mcp",
    "ftp://93.184.215.14/mcp",
    "https://user:pw@93.184.215.14/mcp",
    "https://93.184.215.14:2375/mcp",
])
async def test_ssrf_targets_rejected_at_registration(api: httpx.AsyncClient, register_user: Any,
                                                     fake_mcp: FakeMCPServer, url: str) -> None:
    user = await register_user()
    resp = await api.post(f"{API}/servers", headers=user.headers, json={"name": "evil", "url": url})
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "unsafe_url"
    assert (await api.get(f"{API}/servers", headers=user.headers)).json() == []
    assert fake_mcp.requests == []


async def test_private_hosts_need_operator_allowlist_and_metadata_never_allowed(
        api: httpx.AsyncClient, register_user: Any, fake_mcp: FakeMCPServer,
        monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", ["127.0.0.1", "169.254.169.254"])
    user = await register_user()
    local = await create_server(api, user, name="local_demo", url="http://127.0.0.1:8765/mcp")
    assert local["status"] == "pending_review"
    resp = await api.post(f"{API}/servers", headers=user.headers,
                          json={"name": "meta", "url": "http://169.254.169.254/latest"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "unsafe_url"


async def test_dns_rebinding_to_metadata_is_refused_at_connect_time(
        api: httpx.AsyncClient, register_user: Any, fake_mcp: FakeMCPServer,
        monkeypatch: pytest.MonkeyPatch, patch_dns: Callable[[dict[str, str]], None]) -> None:
    host = "mcp.corp.example"
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", [host])
    patch_dns({host: "10.20.30.40"})  # trusted internal server at registration/approval time
    user = await register_user()
    server = await create_server(api, user, url=f"http://{host}/mcp")
    await approve(api, user, server["id"])

    patch_dns({host: "169.254.169.254"})  # DNS now points at the cloud metadata service
    resp = await api.post(f"{API}/servers/{server['id']}/sync", headers=user.headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "unsafe_url"
    assert fake_mcp.requests == []
    got = (await api.get(f"{API}/servers/{server['id']}", headers=user.headers)).json()
    assert got["status"] == "error"
    assert got["last_error"].startswith("unsafe_url")


async def test_approval_revets_url_against_current_policy(api: httpx.AsyncClient, register_user: Any,
                                                          fake_mcp: FakeMCPServer,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", ["10.9.8.7"])
    user = await register_user()
    server = await create_server(api, user, url="http://10.9.8.7/mcp")
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", [])  # operator withdrew the exception
    resp = await api.post(f"{API}/servers/{server['id']}/approve", headers=user.headers)
    assert resp.status_code == 422
    got = (await api.get(f"{API}/servers/{server['id']}", headers=user.headers)).json()
    assert got["status"] == "pending_review"


# ---------------------------------------------------------------------------- secrets
async def test_secrets_never_in_api_responses_logs_or_audit(api: httpx.AsyncClient, register_user: Any,
                                                            fake_mcp: FakeMCPServer) -> None:
    fake_mcp.expected_auth = SECRET
    user = await register_user()
    bodies: list[str] = []

    resp = await api.post(f"{API}/servers", headers=user.headers,
                          json={"name": "demo", "url": PUBLIC_URL, "auth_header_value": SECRET})
    assert resp.status_code == 201
    bodies.append(resp.text)
    server_id = resp.json()["id"]
    bodies.append((await api.post(f"{API}/servers/{server_id}/approve", headers=user.headers)).text)
    synced = await api.post(f"{API}/servers/{server_id}/sync", headers=user.headers)
    assert synced.status_code == 200
    bodies.append(synced.text)
    bodies.append((await api.get(f"{API}/servers", headers=user.headers)).text)
    bodies.append((await api.get(f"{API}/servers/{server_id}", headers=user.headers)).text)
    bodies.append((await api.get(f"{API}/servers/{server_id}/tools", headers=user.headers)).text)
    tool_id = {t["remote_name"]: t["id"] for t in synced.json()["tools"]}["echo"]
    bodies.append((await api.patch(f"{API}/tools/{tool_id}", headers=user.headers,
                                   json={"enabled": True})).text)
    # Validation errors name the field but never echo the submitted value.
    bad = await api.post(f"{API}/servers", headers=user.headers,
                         json={"name": "bad", "url": PUBLIC_URL, "auth_header_value": SECRET + "\n"})
    assert bad.status_code == 422

    async with system_session() as session:
        stmt = select(MCPServer).where(MCPServer.id == uuid.UUID(server_id))
        row = (await session.execute(stmt)).scalar_one()
    assert row.auth_header_enc is not None
    assert row.auth_header_enc != SECRET
    assert get_key_manager().decrypt(row.auth_header_enc) == SECRET

    token = SECRET.split(" ", 1)[1]
    for body in bodies:
        assert token not in body
        assert row.auth_header_enc not in body
        assert "auth_header_enc" not in body
        assert "auth_header_value" not in body
    assert token not in bad.text
    server_json = (await api.get(f"{API}/servers/{server_id}", headers=user.headers)).json()
    assert server_json["has_auth"] is True
    assert server_json["auth_header_name"] == "Authorization"

    for audit in await audit_rows(user.tenant_id):
        assert token not in str(audit.metadata_)
        assert row.auth_header_enc not in str(audit.metadata_)


async def test_credential_query_parameters_are_masked(api: httpx.AsyncClient, register_user: Any,
                                                      fake_mcp: FakeMCPServer) -> None:
    user = await register_user()
    server = await create_server(api, user, url=f"{PUBLIC_URL}?api_key=abcdef123456&region=eu")
    assert "abcdef123456" not in server["url"]
    assert "region=eu" in server["url"]
    listed = (await api.get(f"{API}/servers", headers=user.headers)).text
    assert "abcdef123456" not in listed


async def test_auth_from_tenant_tool_credential(api: httpx.AsyncClient, register_user: Any,
                                                fake_mcp: FakeMCPServer) -> None:
    fake_mcp.expected_auth = SECRET
    alice = await register_user()
    bob = await register_user()
    async with tenant_session(alice.tenant_id) as session:
        credential = ToolCredential(tenant_id=alice.tenant_id, name="demo-mcp-token", provider="mcp",
                                    secret_encrypted=get_key_manager().encrypt(SECRET),
                                    created_by=alice.user_id)
        session.add(credential)
        await session.commit()
        credential_id = str(credential.id)

    # Another tenant cannot reference Alice's credential.
    resp = await api.post(f"{API}/servers", headers=bob.headers,
                          json={"name": "demo", "url": PUBLIC_URL, "auth_credential_id": credential_id})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_failed"

    server = await create_server(api, alice, auth_credential_id=credential_id)
    assert server["has_auth"] is True
    assert server["auth_credential_id"] == credential_id
    await approve(api, alice, server["id"])
    await sync(api, alice, server["id"])
    assert fake_mcp.headers_for("tools/list")[0]["authorization"] == SECRET

    both = await api.post(f"{API}/servers", headers=alice.headers,
                          json={"name": "both", "url": PUBLIC_URL, "auth_credential_id": credential_id,
                                "auth_header_value": SECRET})
    assert both.status_code == 422


@pytest.mark.parametrize("header", ["Host", "Content-Type", "Mcp-Session-Id", "Cookie", "X-Forwarded-For"])
async def test_gateway_controlled_headers_cannot_be_overridden(api: httpx.AsyncClient, register_user: Any,
                                                               header: str) -> None:
    user = await register_user()
    resp = await api.post(f"{API}/servers", headers=user.headers,
                          json={"name": "demo", "url": PUBLIC_URL, "auth_header_name": header,
                                "auth_header_value": "x"})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------- RBAC / API hygiene
async def test_management_requires_mcp_manage_permission(register_user: Any) -> None:
    user = await register_user()
    viewer_ctx = user.ctx(frozenset({"tools:read"}))
    async with tenant_session(user.tenant_id) as session:
        with pytest.raises(Forbidden):
            await service.register_server(session, viewer_ctx, MCPServerCreate(name="demo", url=PUBLIC_URL))
        with pytest.raises(Forbidden):
            await service.approve_server(session, viewer_ctx, uuid.uuid4())
        with pytest.raises(Forbidden):
            await service.sync_tools(session, viewer_ctx, uuid.uuid4())
        assert await service.list_servers(session, viewer_ctx) == []


async def test_unauthenticated_requests_rejected(api: httpx.AsyncClient) -> None:
    assert (await api.get(f"{API}/servers")).status_code == 401
    assert (await api.post(f"{API}/servers", json={"name": "demo", "url": PUBLIC_URL})).status_code == 401


async def test_duplicate_names_and_idempotent_registration(api: httpx.AsyncClient, register_user: Any,
                                                           fake_mcp: FakeMCPServer) -> None:
    user = await register_user()
    key = {"Idempotency-Key": f"mcp-reg-{uuid.uuid4().hex}"}
    body = {"name": "demo", "url": PUBLIC_URL, "auth_header_value": SECRET}
    first = await api.post(f"{API}/servers", headers={**user.headers, **key}, json=body)
    assert first.status_code == 201
    replay = await api.post(f"{API}/servers", headers={**user.headers, **key}, json=body)
    assert replay.status_code == 201
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert replay.json()["id"] == first.json()["id"]
    assert SECRET.split(" ", 1)[1] not in replay.text

    dup = await api.post(f"{API}/servers", headers=user.headers, json={"name": "demo", "url": PUBLIC_URL})
    assert dup.status_code == 409
    bad_name = await api.post(f"{API}/servers", headers=user.headers,
                              json={"name": "Demo!", "url": PUBLIC_URL})
    assert bad_name.status_code == 422
    stdio = await api.post(f"{API}/servers", headers=user.headers,
                           json={"name": "local", "url": PUBLIC_URL, "transport": "stdio"})
    assert stdio.status_code == 422
    assert len((await api.get(f"{API}/servers", headers=user.headers)).json()) == 1
