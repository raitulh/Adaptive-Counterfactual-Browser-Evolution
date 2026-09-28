"""Strongly typed, environment-driven configuration.

Every setting is read from the environment (or a local ``.env`` file in
development). Critical settings are validated at startup and the process
refuses to start when they are unsafe for the configured environment
(``validate_for_startup``). Secrets are held as ``SecretStr`` so they never
render in logs, reprs or error messages.
"""

from __future__ import annotations

import base64
import binascii
from enum import Enum
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class AppEnv(str, Enum):
    DEVELOPMENT = "development"
    TEST = "test"
    STAGING = "staging"
    PRODUCTION = "production"


class ConfigError(RuntimeError):
    """Raised when configuration is invalid for the current environment."""


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------ app
    app_env: AppEnv = AppEnv.DEVELOPMENT
    app_name: str = "AgentOS"
    app_version: str = "0.1.0"
    debug: bool = False
    api_prefix: str = "/api/v1"
    # Region label recorded on data; groundwork for data residency / regional routing.
    app_region: str = "local"
    public_base_url: str = "http://localhost:8000"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    trusted_hosts: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])
    max_request_body_bytes: int = 2 * 1024 * 1024
    expose_openapi: bool = True

    # ------------------------------------------------------------- database
    database_url: str = "postgresql+asyncpg://agentos:agentos@localhost:5432/agentos"
    database_pool_size: int = 10
    database_max_overflow: int = 10
    database_pool_timeout_seconds: float = 10.0
    database_statement_timeout_ms: int = 15_000
    database_connect_timeout_seconds: float = 5.0
    database_echo: bool = False

    # ---------------------------------------------------------------- redis
    redis_url: str = "redis://localhost:6379/0"
    redis_socket_timeout_seconds: float = 2.0
    redis_connect_timeout_seconds: float = 2.0

    # ------------------------------------------------------ auth / sessions
    jwt_secret: SecretStr = SecretStr("dev-only-insecure-jwt-secret-change-me-0123456789")
    # Comma-separated secrets still accepted for verification during a JWT_SECRET rotation (never used to sign).
    jwt_previous_secrets: SecretStr = SecretStr("")
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = "agentos"
    jwt_audience: str = "agentos-api"
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 30 * 24 * 3600
    session_idle_timeout_seconds: int = 14 * 24 * 3600
    stream_token_ttl_seconds: int = 120
    cookie_secure: bool = False
    cookie_domain: str | None = None
    login_max_failures: int = 5
    login_lockout_seconds: int = 900
    password_min_length: int = 10

    # --------------------------------------------------- encryption / KMS
    # Fernet key (urlsafe base64, 32 bytes). Generate: python -c "from cryptography.fernet import
    # Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: SecretStr = SecretStr("")
    # Previous keys still accepted for decryption during rotation (comma separated).
    token_encryption_previous_keys: SecretStr = SecretStr("")
    kms_provider: Literal["local", "gcp", "aws"] = "local"
    kms_key_id: str | None = None

    # ------------------------------------------------------- model gateway
    model_provider: Literal["gemini", "scripted"] = "gemini"
    gemini_api_key: SecretStr = SecretStr("")
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_default_model: str = "gemini-2.5-flash"
    gemini_fast_model: str = "gemini-2.5-flash-lite"
    gemini_reasoning_model: str = "gemini-2.5-pro"
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_use_json_schema: bool = True
    embedding_dimensions: int = 768
    model_timeout_seconds: float = 60.0
    model_max_retries: int = 2
    model_max_output_tokens: int = 8192

    # ------------------------------------------------------- google oauth
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:8000/api/v1/integrations/google/callback"
    google_login_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/google/callback"
    google_api_timeout_seconds: float = 20.0
    oauth_state_ttl_seconds: int = 600
    frontend_oauth_success_url: str = "http://localhost:3000/integrations?status=connected"
    frontend_oauth_error_url: str = "http://localhost:3000/integrations?status=error"

    # ------------------------------------------------------ object storage
    object_storage_backend: Literal["local", "s3"] = "local"
    object_storage_endpoint: str | None = None
    object_storage_bucket: str = "agentos"
    object_storage_access_key: SecretStr = SecretStr("")
    object_storage_secret_key: SecretStr = SecretStr("")
    object_storage_region: str = "us-east-1"
    local_storage_path: str = ".data/objects"
    signed_url_ttl_seconds: int = 300
    file_max_upload_bytes: int = 25 * 1024 * 1024
    malware_scanner: Literal["none", "clamav"] = "none"
    clamav_host: str = "localhost"
    clamav_port: int = 3310

    # ---------------------------------------------------------- rate limit
    rate_limit_enabled: bool = True
    rate_limit_fail_open: bool = True
    rate_limit_ip_per_minute: int = 300
    rate_limit_user_per_minute: int = 240
    rate_limit_tenant_per_minute: int = 1200
    rate_limit_auth_per_minute: int = 10
    rate_limit_task_create_per_minute: int = 20
    rate_limit_search_per_minute: int = 30
    rate_limit_model_calls_per_minute: int = 120
    rate_limit_tool_calls_per_minute: int = 240
    rate_limit_browser_launch_per_minute: int = 10
    rate_limit_automation_create_per_hour: int = 30

    # ------------------------------------------------------ browser worker
    browser_enabled: bool = True
    browser_headless: bool = True
    browser_max_concurrency: int = 2
    browser_task_timeout_seconds: int = 120
    browser_action_timeout_ms: int = 15_000
    browser_max_actions: int = 40
    browser_allowed_domains: Annotated[list[str], NoDecode] = Field(default_factory=list)
    browser_denied_domains: Annotated[list[str], NoDecode] = Field(default_factory=list)
    browser_allow_downloads: bool = False
    browser_executable_path: str | None = None

    # -------------------------------------------------------------- queue
    queue_backend: Literal["postgres"] = "postgres"
    worker_concurrency: int = 8
    worker_poll_interval_seconds: float = 0.5
    job_lease_seconds: int = 120
    job_max_attempts: int = 5
    worker_shutdown_grace_seconds: int = 30
    scheduler_interval_seconds: float = 5.0

    # ---------------------------------------------------- task limits
    max_plan_steps: int = 20
    max_tool_calls_per_task: int = 60
    max_model_calls_per_task: int = 30
    max_browser_actions_per_task: int = 80
    max_task_duration_seconds: int = 6 * 3600
    max_task_cost_usd: float = 2.0
    max_replans_per_task: int = 2
    max_plan_repair_attempts: int = 2
    max_concurrent_tasks_per_user: int = 10
    approval_ttl_seconds: int = 24 * 3600
    approval_execution_window_seconds: int = 3600

    # -------------------------------------------------------- search
    search_provider: Literal["none", "brave", "google_cse"] = "none"
    search_api_key: SecretStr = SecretStr("")
    google_cse_id: str = ""
    search_timeout_seconds: float = 15.0

    # -------------------------------------------------------- network / SSRF
    allow_private_network_egress: bool = False
    outbound_http_timeout_seconds: float = 20.0
    outbound_max_response_bytes: int = 5 * 1024 * 1024

    # -------------------------------------------------------- MCP
    mcp_enabled: bool = True
    mcp_call_timeout_seconds: float = 30.0
    mcp_allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # -------------------------------------------------------- notifications
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr = SecretStr("")
    smtp_use_tls: bool = True
    smtp_from_address: str = "no-reply@agentos.local"

    # -------------------------------------------------------- webhooks
    webhook_signing_secret: SecretStr = SecretStr("")
    webhook_tolerance_seconds: int = 300

    # -------------------------------------------------------- observability
    log_level: str = "INFO"
    log_json: bool = True
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str | None = None
    otel_service_name: str = "agentos-backend"
    metrics_enabled: bool = True
    # When false, a Redis outage is reported by /ready but does not take API pods out of load balancing
    # (rate limits fail open and task streams fall back to database polling; OAuth flows need Redis).
    readiness_requires_redis: bool = False
    metrics_bearer_token: SecretStr = SecretStr("")
    worker_metrics_port: int | None = None
    sentry_dsn: SecretStr = SecretStr("")

    # -------------------------------------------------------- billing
    billing_provider: Literal["none"] = "none"
    default_plan: Literal["free", "pro", "team", "enterprise"] = "free"

    # -------------------------------------------------------- retention (days)
    retention_task_events_days: int = 180
    retention_execution_logs_days: int = 90
    retention_audit_days: int = 365 * 2
    retention_usage_events_days: int = 400
    retention_notifications_days: int = 90
    retention_temp_files_days: int = 7
    retention_browser_artifacts_days: int = 7
    retention_deleted_memory_days: int = 30

    # ---------------------------------------------------------------- validators
    @field_validator(
        "cors_origins",
        "trusted_hosts",
        "browser_allowed_domains",
        "browser_denied_domains",
        "mcp_allowed_hosts",
        mode="before",
    )
    @classmethod
    def _csv(cls, value: object) -> object:
        return _split_csv(value)

    @field_validator("api_prefix")
    @classmethod
    def _prefix(cls, value: str) -> str:
        if not value.startswith("/") or value.endswith("/"):
            raise ValueError("api_prefix must start with '/' and not end with '/'")
        return value

    # ---------------------------------------------------------------- helpers
    @property
    def is_production(self) -> bool:
        return self.app_env in (AppEnv.PRODUCTION, AppEnv.STAGING)

    @property
    def is_test(self) -> bool:
        return self.app_env == AppEnv.TEST

    def encryption_keys(self) -> list[bytes]:
        previous = self.token_encryption_previous_keys.get_secret_value()
        keys = [self.token_encryption_key.get_secret_value(), *(k.strip() for k in previous.split(","))]
        return [k.encode() for k in keys if k]

    def jwt_verification_secrets(self) -> list[str]:
        """Primary secret first (the only one used to sign), then previous secrets accepted during rotation."""
        previous = self.jwt_previous_secrets.get_secret_value()
        return [self.jwt_secret.get_secret_value(), *(k.strip() for k in previous.split(",") if k.strip())]

    def validate_for_startup(self) -> None:
        """Fail fast on unsafe or incomplete critical configuration."""
        errors: list[str] = []
        jwt_secret = self.jwt_secret.get_secret_value()
        if len(jwt_secret) < 32:
            errors.append("JWT_SECRET must be at least 32 characters")
        if any(len(k) < 32 for k in self.jwt_verification_secrets()[1:]):
            errors.append("JWT_PREVIOUS_SECRETS entries must be at least 32 characters")
        if not self.database_url.startswith("postgresql+asyncpg://"):
            errors.append("DATABASE_URL must use the postgresql+asyncpg:// driver")
        keys = self.encryption_keys()
        if not keys:
            errors.append("TOKEN_ENCRYPTION_KEY is required (Fernet key)")
        for key in keys:
            if not _is_valid_fernet_key(key):
                errors.append("TOKEN_ENCRYPTION_KEY / previous keys must be valid Fernet keys")
                break
        if self.embedding_dimensions <= 0 or self.embedding_dimensions > 2000:
            errors.append("EMBEDDING_DIMENSIONS must be between 1 and 2000 (pgvector index limit)")

        if self.is_production:
            if "dev-only" in jwt_secret:
                errors.append("JWT_SECRET is the development default")
            if self.debug:
                errors.append("DEBUG must be false in staging/production")
            if not self.cookie_secure:
                errors.append("COOKIE_SECURE must be true in staging/production")
            if "*" in self.cors_origins:
                errors.append("CORS_ORIGINS may not contain '*' in staging/production")
            if self.model_provider != "gemini":
                errors.append("MODEL_PROVIDER must be 'gemini' in staging/production (scripted is test-only)")
            if not self.gemini_api_key.get_secret_value():
                errors.append("GEMINI_API_KEY is required in staging/production")
            if self.allow_private_network_egress:
                errors.append("ALLOW_PRIVATE_NETWORK_EGRESS must be false in staging/production")
            if self.object_storage_backend == "local":
                errors.append("OBJECT_STORAGE_BACKEND=local is not durable; use s3 in staging/production")
        if errors:
            raise ConfigError("Invalid configuration: " + "; ".join(errors))


def _is_valid_fernet_key(key: bytes) -> bool:
    try:
        return len(base64.urlsafe_b64decode(key)) == 32
    except (binascii.Error, ValueError):
        return False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
