"""Runtime configuration, read from environment variables (and an optional `.env`)."""

from __future__ import annotations

import ipaddress
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Used only outside production so `uvicorn app.main:app` works out of the box.
# Production refuses to start with it.
INSECURE_DEV_SECRET = "dev-insecure-secret-key-change-me-0000000000000000"  # noqa: S105

CommaList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    # Empty values (e.g. `COOKIE_SECURE=` copied from .env.example) mean "use the default".
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", env_ignore_empty=True
    )

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    docs_enabled: bool = True

    database_url: str = "postgresql+psycopg://realhuman:realhuman@localhost:5432/realhuman"
    secret_key: str = INSECURE_DEV_SECRET

    # Browser origins allowed to call every endpoint with credentials (the dashboard).
    cors_origins: CommaList = Field(default_factory=lambda: ["http://localhost:3000"])
    # Let any origin call the public widget endpoints (create session, submit
    # challenge) without credentials, so the widget can be embedded anywhere.
    widget_cors_any_origin: bool = True

    # Dashboard auth cookie.
    cookie_name: str = "rh_session"
    cookie_secure: bool | None = None  # None → secure in production only
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None
    auth_session_ttl_hours: int = Field(default=168, ge=1, le=24 * 90)

    # Verification.
    verification_session_ttl_seconds: int = Field(default=120, ge=10, le=3600)
    verification_token_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    max_challenge_attempts: int = Field(default=3, ge=1, le=10)
    hold_duration_ms: int = Field(default=1100, ge=200, le=10_000)
    # Project used when the widget sends no site key (e.g. the landing-page demo).
    default_site_key: str | None = None

    # Demo data, for local development only.
    seed_demo: bool = False
    demo_email: str = "demo@realhuman.dev"
    demo_password: str = ""
    demo_site_key: str = "pk_test_demo_5f2c81a9e04b"

    # Number of reverse proxies in front of the API whose X-Forwarded-For is trusted.
    trusted_proxy_count: int = Field(default=0, ge=0, le=5)

    # Rate limits (per client IP unless noted).
    rate_limit_enabled: bool = True
    rate_limit_sessions_per_minute: int = 30
    rate_limit_challenges_per_minute: int = 30
    rate_limit_auth_per_minute: int = 10
    rate_limit_contact_per_hour: int = 10
    rate_limit_verify_per_minute: int = 600  # per API key

    # Network reputation inputs (CIDR lists).
    blocklist_cidrs: CommaList = Field(default_factory=list)
    datacenter_cidrs: CommaList = Field(default_factory=list)

    # Webhooks.
    webhook_timeout_seconds: float = 5.0
    webhook_max_attempts: int = Field(default=6, ge=1, le=20)
    webhook_allow_private_targets: bool = False

    # Background worker (webhook delivery, session expiry, retention).
    worker_enabled: bool = True
    worker_interval_seconds: float = Field(default=5.0, gt=0)

    @field_validator("cors_origins", "blocklist_cidrs", "datacenter_cidrs", mode="before")
    @classmethod
    def _split_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _normalize_origins(cls, value: list[str]) -> list[str]:
        return [origin.rstrip("/") for origin in value]

    @field_validator("blocklist_cidrs", "datacenter_cidrs")
    @classmethod
    def _validate_cidrs(cls, value: list[str]) -> list[str]:
        for cidr in value:
            ipaddress.ip_network(cidr, strict=False)
        return value

    @model_validator(mode="after")
    def _check_production(self) -> Settings:
        if self.environment == "production":
            if self.secret_key == INSECURE_DEV_SECRET or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be set to a random value of 32+ characters.")
            if self.seed_demo:
                raise ValueError("SEED_DEMO must be false in production.")
        if self.cookie_samesite == "none" and self.cookie_secure is False:
            raise ValueError("COOKIE_SAMESITE=none requires secure cookies.")
        return self

    @property
    def cookie_secure_effective(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.environment == "production" or self.cookie_samesite == "none"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
