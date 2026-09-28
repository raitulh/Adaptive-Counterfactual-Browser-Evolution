"""Google OAuth 2.0 / OpenID Connect primitives (authorization-code + PKCE).

Used by both "Sign in with Google" (auth module) and account *connections*
for Gmail/Calendar/Drive (integrations module). Nothing here stores tokens;
callers persist them encrypted via the credential vault.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    ConfigurationMissing,
    IntegrationBadRequest,
    IntegrationRevoked,
    IntegrationTimeout,
    IntegrationUnavailable,
    Unauthorized,
    ValidationFailed,
)
from app.core.redis import get_redis

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# Least-privilege scope bundles, requested incrementally per capability.
SCOPES_OPENID = ["openid", "email", "profile"]
CAPABILITY_SCOPES: dict[str, list[str]] = {
    "gmail.read": ["https://www.googleapis.com/auth/gmail.readonly"],
    "gmail.compose": ["https://www.googleapis.com/auth/gmail.compose"],
    "gmail.send": ["https://www.googleapis.com/auth/gmail.send"],
    "calendar.read": ["https://www.googleapis.com/auth/calendar.readonly"],
    "calendar.write": ["https://www.googleapis.com/auth/calendar.events"],
    "drive.read": ["https://www.googleapis.com/auth/drive.readonly"],
    "drive.file": ["https://www.googleapis.com/auth/drive.file"],
    "contacts.read": ["https://www.googleapis.com/auth/contacts.readonly"],
}

# Scopes that imply others (a broader grant satisfies a narrower requirement).
SCOPE_IMPLIES: dict[str, set[str]] = {
    "https://www.googleapis.com/auth/calendar.events": {"https://www.googleapis.com/auth/calendar.readonly",
                                                        "https://www.googleapis.com/auth/calendar.events.readonly"},
    "https://www.googleapis.com/auth/calendar": {"https://www.googleapis.com/auth/calendar.events",
                                                 "https://www.googleapis.com/auth/calendar.readonly"},
    "https://www.googleapis.com/auth/gmail.modify": {"https://www.googleapis.com/auth/gmail.readonly",
                                                     "https://www.googleapis.com/auth/gmail.compose",
                                                     "https://www.googleapis.com/auth/gmail.send"},
    "https://www.googleapis.com/auth/gmail.compose": {"https://www.googleapis.com/auth/gmail.send"},
    "https://www.googleapis.com/auth/drive": {"https://www.googleapis.com/auth/drive.readonly",
                                              "https://www.googleapis.com/auth/drive.file"},
}


def expand_granted(scopes: set[str]) -> set[str]:
    out = set(scopes)
    for scope in scopes:
        out |= SCOPE_IMPLIES.get(scope, set())
    return out


def missing_scopes(granted: set[str], required: list[str]) -> list[str]:
    effective = expand_granted(granted)
    return [s for s in required if s not in effective]


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


@dataclass(slots=True)
class GoogleTokenResponse:
    access_token: str
    expires_in: int
    scope: set[str]
    token_type: str
    refresh_token: str | None = None
    id_token: str | None = None


@dataclass(slots=True)
class GoogleIdentity:
    subject: str
    email: str
    email_verified: bool
    name: str | None


class OAuthStateStore:
    """Single-use OAuth state (CSRF + PKCE verifier + nonce) kept in Redis with a TTL."""

    PREFIX = "oauth_state:"

    def __init__(self, redis: Any | None = None, ttl_seconds: int | None = None) -> None:
        self._redis = redis or get_redis()
        self._ttl = ttl_seconds or get_settings().oauth_state_ttl_seconds

    async def create(self, data: dict[str, Any]) -> str:
        state = secrets.token_urlsafe(32)
        await self._redis.set(self.PREFIX + state, json.dumps(data), ex=self._ttl)
        return state

    async def consume(self, state: str) -> dict[str, Any]:
        if not state or len(state) > 128:
            raise ValidationFailed("Invalid OAuth state")
        raw = await self._redis.getdel(self.PREFIX + state)
        if raw is None:
            raise ValidationFailed("OAuth state is invalid, expired or already used", code="oauth_state_invalid")
        return dict(json.loads(raw))


class GoogleOAuthClient:
    def __init__(self, settings: Settings | None = None, http: httpx.AsyncClient | None = None) -> None:
        self.settings = settings or get_settings()
        self._http = http
        self._jwks: dict[str, Any] | None = None
        self._jwks_fetched = 0.0

    def _require_config(self) -> None:
        if not self.settings.google_client_id or not self.settings.google_client_secret.get_secret_value():
            raise ConfigurationMissing("Google OAuth is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)")

    def _client(self) -> httpx.AsyncClient:
        return self._http or httpx.AsyncClient(timeout=self.settings.google_api_timeout_seconds)

    def authorization_url(self, *, scopes: list[str], state: str, code_challenge: str, redirect_uri: str,
                          nonce: str | None = None, login_hint: str | None = None, offline: bool = True) -> str:
        self._require_config()
        params = {
            "client_id": self.settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(dict.fromkeys(scopes)),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "include_granted_scopes": "true",
        }
        if offline:
            params["access_type"] = "offline"
            params["prompt"] = "consent"
        if nonce:
            params["nonce"] = nonce
        if login_hint:
            params["login_hint"] = login_hint
        return f"{AUTH_URL}?{urlencode(params)}"

    async def _token_request(self, data: dict[str, str]) -> dict[str, Any]:
        self._require_config()
        body = {
            **data,
            "client_id": self.settings.google_client_id,
            "client_secret": self.settings.google_client_secret.get_secret_value(),
        }
        client = self._client()
        try:
            response = await client.post(TOKEN_URL, data=body)
        except httpx.TimeoutException as exc:
            raise IntegrationTimeout("Google token endpoint timed out", provider="google") from exc
        except httpx.HTTPError as exc:
            raise IntegrationUnavailable("Google token endpoint unreachable", provider="google") from exc
        finally:
            if self._http is None:
                await client.aclose()
        payload: dict[str, Any] = {}
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 500 or response.status_code == 429:
            raise IntegrationUnavailable("Google token endpoint unavailable", provider="google",
                                         status=response.status_code)
        if response.status_code != 200:
            error = str(payload.get("error", "unknown"))
            if error == "invalid_grant":
                raise IntegrationRevoked("Google authorization is no longer valid", provider="google",
                                         details={"oauth_error": error})
            raise IntegrationBadRequest("Google rejected the token request", provider="google",
                                        details={"oauth_error": error})
        return payload

    @staticmethod
    def _parse(payload: dict[str, Any]) -> GoogleTokenResponse:
        return GoogleTokenResponse(
            access_token=str(payload["access_token"]),
            expires_in=int(payload.get("expires_in", 3600)),
            scope=set(str(payload.get("scope", "")).split()),
            token_type=str(payload.get("token_type", "Bearer")),
            refresh_token=payload.get("refresh_token"),
            id_token=payload.get("id_token"),
        )

    async def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> GoogleTokenResponse:
        payload = await self._token_request({
            "grant_type": "authorization_code", "code": code, "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
        })
        return self._parse(payload)

    async def refresh(self, refresh_token: str) -> GoogleTokenResponse:
        payload = await self._token_request({"grant_type": "refresh_token", "refresh_token": refresh_token})
        return self._parse(payload)

    async def revoke(self, token: str) -> bool:
        client = self._client()
        try:
            response = await client.post(REVOKE_URL, data={"token": token})
            return response.status_code in (200, 400)  # 400 = already invalid
        except httpx.HTTPError:
            return False
        finally:
            if self._http is None:
                await client.aclose()

    async def _jwks_keys(self, force: bool = False) -> dict[str, Any]:
        if self._jwks is None or force or time.time() - self._jwks_fetched > 3600:
            client = self._client()
            try:
                response = await client.get(JWKS_URL)
                response.raise_for_status()
                self._jwks = response.json()
                self._jwks_fetched = time.time()
            except httpx.HTTPError as exc:
                raise IntegrationUnavailable("Could not fetch Google signing keys", provider="google") from exc
            finally:
                if self._http is None:
                    await client.aclose()
        return self._jwks or {}

    async def verify_id_token(self, id_token: str, *, nonce: str | None) -> GoogleIdentity:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise Unauthorized("Invalid ID token", code="invalid_id_token") from exc
        kid = header.get("kid")
        keys = await self._jwks_keys()
        key_data = next((k for k in keys.get("keys", []) if k.get("kid") == kid), None)
        if key_data is None:
            keys = await self._jwks_keys(force=True)
            key_data = next((k for k in keys.get("keys", []) if k.get("kid") == kid), None)
        if key_data is None:
            raise Unauthorized("Unknown ID token signing key", code="invalid_id_token")
        try:
            claims = jwt.decode(
                id_token, key=jwt.PyJWK(key_data).key, algorithms=["RS256"],
                audience=self.settings.google_client_id, options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            )
        except jwt.PyJWTError as exc:
            raise Unauthorized("Invalid ID token", code="invalid_id_token") from exc
        if claims.get("iss") not in ISSUERS:
            raise Unauthorized("Invalid ID token issuer", code="invalid_id_token")
        if nonce is not None and claims.get("nonce") != nonce:
            raise Unauthorized("ID token nonce mismatch", code="invalid_id_token")
        return GoogleIdentity(subject=str(claims["sub"]), email=str(claims.get("email", "")),
                              email_verified=bool(claims.get("email_verified")), name=claims.get("name"))
