"""Google sign-in and account-connection flows end to end (PKCE, single-use state,
nonce + JWKS-verified ID token, encrypted token storage, revocation)."""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.integrations.google.oauth import set_google_http
from app.integrations.models import OAuthConnection

pytestmark = pytest.mark.integration


class FakeGoogleOAuth:
    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "test-kid"
        self.nonce: str | None = None
        self.subject = "google-sub-123"
        self.email = "person@example.com"
        self.scope = "openid email profile"
        self.audience = get_settings().google_client_id
        self.revoked: list[str] = []
        self.code_verifiers: list[str] = []

    def id_token(self) -> str:
        now = int(time.time())
        claims = {"iss": "https://accounts.google.com", "aud": self.audience, "sub": self.subject,
                  "email": self.email, "email_verified": True, "name": "Person", "iat": now, "exp": now + 600,
                  "nonce": self.nonce}
        return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": self.kid})

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith("https://www.googleapis.com/oauth2/v3/certs"):
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            jwk.update({"kid": self.kid, "use": "sig", "alg": "RS256"})
            return httpx.Response(200, json={"keys": [jwk]})
        form = {k: v[-1] for k, v in parse_qs(request.content.decode()).items()}
        if url.startswith("https://oauth2.googleapis.com/token"):
            assert form["grant_type"] == "authorization_code" and form["code"] == "auth-code"
            self.code_verifiers.append(form["code_verifier"])
            return httpx.Response(200, json={"access_token": "ya29.access-secret-value", "expires_in": 3599,
                                             "refresh_token": "1//refresh-secret-value", "scope": self.scope,
                                             "token_type": "Bearer", "id_token": self.id_token()})
        if url.startswith("https://oauth2.googleapis.com/revoke"):
            self.revoked.append(form["token"])
            return httpx.Response(200)
        return httpx.Response(404)


@pytest.fixture
async def google():
    fake = FakeGoogleOAuth()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handle))
    set_google_http(client)
    yield fake
    set_google_http(None)
    await client.aclose()


def _query(url: str) -> dict[str, str]:
    return {k: v[-1] for k, v in parse_qs(urlsplit(url).query).items()}


async def test_sign_in_with_google(client, google):
    start = (await client.get("/api/v1/auth/oauth/google/start")).json()
    params = _query(start["authorization_url"])
    assert params["code_challenge_method"] == "S256" and params["scope"] == "openid email profile"
    google.nonce = params["nonce"]
    resp = await client.get("/api/v1/auth/oauth/google/callback",
                            params={"code": "auth-code", "state": params["state"], "token_delivery": "body"})
    assert resp.status_code == 200, resp.text
    tokens = resp.json()
    me = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json()["email"] == google.email and me.json()["email_verified"]
    replay = await client.get("/api/v1/auth/oauth/google/callback",
                              params={"code": "auth-code", "state": params["state"], "token_delivery": "body"})
    assert replay.status_code == 422 and replay.json()["error"]["code"] == "oauth_state_invalid"


async def test_sign_in_rejects_nonce_mismatch_and_wrong_audience(client, google):
    params = _query((await client.get("/api/v1/auth/oauth/google/start")).json()["authorization_url"])
    google.nonce = "someone-elses-nonce"
    bad = await client.get("/api/v1/auth/oauth/google/callback", params={"code": "auth-code", "state": params["state"]})
    assert bad.status_code == 401
    params = _query((await client.get("/api/v1/auth/oauth/google/start")).json()["authorization_url"])
    google.nonce, google.audience = params["nonce"], "other-client.apps.googleusercontent.com"
    bad = await client.get("/api/v1/auth/oauth/google/callback", params={"code": "auth-code", "state": params["state"]})
    assert bad.status_code == 401


async def test_connect_google_account_stores_encrypted_tokens_and_disconnects(client, make_user, google):
    user = await make_user()
    started = await client.post("/api/v1/integrations/google/connect",
                                json={"capabilities": ["calendar.read", "gmail.send"]}, headers=user.headers)
    assert started.status_code == 200, started.text
    body: dict[str, Any] = started.json()
    assert "https://www.googleapis.com/auth/gmail.send" in body["requested_scopes"]
    assert "https://mail.google.com/" not in body["requested_scopes"]  # least privilege
    params = _query(body["authorization_url"])
    assert params["access_type"] == "offline" and params["include_granted_scopes"] == "true"
    google.nonce = params["nonce"]
    google.scope = ("openid email https://www.googleapis.com/auth/calendar.readonly "
                    "https://www.googleapis.com/auth/gmail.send")
    cb = await client.get("/api/v1/integrations/google/callback", params={"code": "auth-code", "state": params["state"]},
                          follow_redirects=False)
    assert cb.status_code == 302 and "status=connected" in cb.headers["location"]
    conns = (await client.get("/api/v1/integrations", headers=user.headers)).json()
    assert conns[0]["status"] == "connected" and set(conns[0]["capabilities"]) >= {"calendar.read", "gmail.send"}
    assert "secret-value" not in json.dumps(conns)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = user.tenant_id
        row = (await s.execute(select(OAuthConnection).where(OAuthConnection.user_id == user.user_id))).scalar_one()
        assert "secret-value" not in (row.access_token_enc or "") + (row.refresh_token_enc or "")
    out = await client.post(f"/api/v1/integrations/{conns[0]['id']}/disconnect", headers=user.headers)
    assert out.status_code == 200 and out.json()["status"] == "disconnected"
    assert google.revoked == ["1//refresh-secret-value"]


async def test_callback_with_forged_state_redirects_to_error(client, google):
    cb = await client.get("/api/v1/integrations/google/callback", params={"code": "auth-code", "state": "forged"},
                          follow_redirects=False)
    assert cb.status_code == 302 and "status=error" in cb.headers["location"]
