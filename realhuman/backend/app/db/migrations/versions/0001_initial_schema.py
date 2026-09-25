"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-25 05:58:58.098322
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contact_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("company", sa.String(length=120), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contact_requests")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("workspace_name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_sessions_token_hash")),
    )
    op.create_index(
        op.f("ix_auth_sessions_expires_at"), "auth_sessions", ["expires_at"], unique=False
    )
    op.create_index(op.f("ix_auth_sessions_user_id"), "auth_sessions", ["user_id"], unique=False)
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("site_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_projects_owner_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    op.create_index(op.f("ix_projects_owner_id"), "projects", ["owner_id"], unique=False)
    op.create_index(op.f("ix_projects_site_key"), "projects", ["site_key"], unique=True)
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column("environment", sa.String(length=8), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("masked_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_api_keys_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_keys")),
        sa.UniqueConstraint("key_hash", name=op.f("uq_api_keys_key_hash")),
    )
    op.create_index(op.f("ix_api_keys_project_id"), "api_keys", ["project_id"], unique=False)
    op.create_table(
        "project_settings",
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("allow_threshold", sa.Float(), nullable=False),
        sa.Column("step_up_threshold", sa.Float(), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_settings_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", name=op.f("pk_project_settings")),
    )
    op.create_table(
        "request_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("method", sa.String(length=8), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_request_logs_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_request_logs")),
    )
    op.create_index(
        "ix_request_logs_project_created",
        "request_logs",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "verification_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("challenge_type", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=True),
        sa.Column("origin", sa.String(length=255), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("ua_hash", sa.String(length=64), nullable=False),
        sa.Column("lang_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_challenge", sa.String(length=16), nullable=True),
        sa.Column("outcome", sa.String(length=16), nullable=True),
        sa.Column("decision", sa.String(length=16), nullable=True),
        sa.Column("risk", sa.String(length=8), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_verification_sessions_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_verification_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_verification_sessions_token_hash")),
    )
    op.create_index(
        "ix_verification_sessions_ip_created",
        "verification_sessions",
        ["ip_hash", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_verification_sessions_outcome"), "verification_sessions", ["outcome"], unique=False
    )
    op.create_index(
        "ix_verification_sessions_project_created",
        "verification_sessions",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_verification_sessions_status_expires",
        "verification_sessions",
        ["status", "expires_at"],
        unique=False,
    )
    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column(
            "events",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_webhook_endpoints_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhook_endpoints")),
    )
    op.create_index(
        op.f("ix_webhook_endpoints_project_id"), "webhook_endpoints", ["project_id"], unique=False
    )
    op.create_table(
        "signals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("signal_id", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("detail", sa.String(length=255), nullable=True),
        sa.Column(
            "factors",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["verification_sessions.id"],
            name=op.f("fk_signals_session_id_verification_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_signals")),
    )
    op.create_index(op.f("ix_signals_session_id"), "signals", ["session_id"], unique=False)
    op.create_table(
        "verification_events",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("risk", sa.String(length=8), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("origin", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_verification_events_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["verification_sessions.id"],
            name=op.f("fk_verification_events_session_id_verification_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_verification_events")),
    )
    op.create_index(
        "ix_verification_events_project_created",
        "verification_events",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_verification_events_session_id"),
        "verification_events",
        ["session_id"],
        unique=False,
    )
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("endpoint_id", sa.String(length=32), nullable=False),
        sa.Column("event_id", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column(
            "payload",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status_code", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["endpoint_id"],
            ["webhook_endpoints.id"],
            name=op.f("fk_webhook_deliveries_endpoint_id_webhook_endpoints"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhook_deliveries")),
    )
    op.create_index(
        op.f("ix_webhook_deliveries_endpoint_id"),
        "webhook_deliveries",
        ["endpoint_id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_status_next",
        "webhook_deliveries",
        ["status", "next_attempt_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_status_next", table_name="webhook_deliveries")
    op.drop_index(op.f("ix_webhook_deliveries_endpoint_id"), table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_index(op.f("ix_verification_events_session_id"), table_name="verification_events")
    op.drop_index("ix_verification_events_project_created", table_name="verification_events")
    op.drop_table("verification_events")
    op.drop_index(op.f("ix_signals_session_id"), table_name="signals")
    op.drop_table("signals")
    op.drop_index(op.f("ix_webhook_endpoints_project_id"), table_name="webhook_endpoints")
    op.drop_table("webhook_endpoints")
    op.drop_index("ix_verification_sessions_status_expires", table_name="verification_sessions")
    op.drop_index("ix_verification_sessions_project_created", table_name="verification_sessions")
    op.drop_index(op.f("ix_verification_sessions_outcome"), table_name="verification_sessions")
    op.drop_index("ix_verification_sessions_ip_created", table_name="verification_sessions")
    op.drop_table("verification_sessions")
    op.drop_index("ix_request_logs_project_created", table_name="request_logs")
    op.drop_table("request_logs")
    op.drop_table("project_settings")
    op.drop_index(op.f("ix_api_keys_project_id"), table_name="api_keys")
    op.drop_table("api_keys")
    op.drop_index(op.f("ix_projects_site_key"), table_name="projects")
    op.drop_index(op.f("ix_projects_owner_id"), table_name="projects")
    op.drop_table("projects")
    op.drop_index(op.f("ix_auth_sessions_user_id"), table_name="auth_sessions")
    op.drop_index(op.f("ix_auth_sessions_expires_at"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
    op.drop_table("contact_requests")
