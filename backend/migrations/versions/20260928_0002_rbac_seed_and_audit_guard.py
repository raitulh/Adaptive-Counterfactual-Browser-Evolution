"""RBAC catalogue seed and append-only guard for audit_logs.

Revision ID: 0002_rbac_seed_audit_guard
Revises: 0001_initial_schema
Create Date: 2026-09-28
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_rbac_seed_audit_guard"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of the catalogue at this revision (migrations must not import live app code that may change).
PERMISSIONS: dict[str, str] = {
    "tasks:create": "Create agent tasks",
    "tasks:read": "Read own tasks",
    "tasks:read_all": "Read all tasks in the organization",
    "tasks:cancel": "Cancel/pause/resume own tasks",
    "approvals:decide": "Approve or reject actions on own tasks",
    "approvals:decide_any": "Approve or reject actions on any task in the organization",
    "agents:read": "Read agents",
    "agents:manage": "Create and version agents",
    "memory:read": "Read own memories",
    "memory:write": "Create and delete own memories",
    "tools:read": "List tools",
    "tools:manage": "Manage organization tool policies and credentials",
    "integrations:manage": "Connect and disconnect own integrations",
    "automations:manage": "Create and manage automations",
    "files:read": "Read files",
    "files:write": "Upload and delete files",
    "audit:read": "Read the organization audit log",
    "usage:read": "Read usage",
    "members:manage": "Invite, remove and change roles of members",
    "org:manage": "Manage organization settings and policy",
    "mcp:manage": "Register and approve MCP servers",
    "billing:manage": "Manage billing",
    "experiments:manage": "Manage experiments and ACBE strategy promotion",
    "search:use": "Run web searches",
}
_MEMBER = {"tasks:create", "tasks:read", "tasks:cancel", "approvals:decide", "agents:read", "agents:manage",
           "memory:read", "memory:write", "tools:read", "integrations:manage", "automations:manage", "files:read",
           "files:write", "usage:read", "search:use"}
_VIEWER = {"tasks:read", "agents:read", "memory:read", "tools:read", "files:read"}
_ADMIN = _MEMBER | {"tasks:read_all", "approvals:decide_any", "tools:manage", "audit:read", "members:manage",
                    "org:manage", "mcp:manage", "experiments:manage"}
_OWNER = _ADMIN | {"billing:manage"}
ROLES: dict[str, tuple[str, set[str]]] = {
    "owner": ("Full control of the organization", _OWNER),
    "admin": ("Administers members, policies, tools and audit", _ADMIN),
    "member": ("Runs agents and manages own resources", _MEMBER),
    "viewer": ("Read-only access", _VIEWER),
}

AUDIT_GUARD_FUNCTION = """
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Retention purges run in a transaction that sets this flag explicitly (and are audited).
  IF current_setting('agentos.audit_retention', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END $$;
"""


def upgrade() -> None:
    conn = op.get_bind()
    permissions = sa.table("permissions", sa.column("id", sa.Uuid), sa.column("code", sa.String),
                           sa.column("description", sa.Text))
    roles = sa.table("roles", sa.column("id", sa.Uuid), sa.column("tenant_id", sa.Uuid), sa.column("name", sa.String),
                     sa.column("description", sa.Text), sa.column("is_system", sa.Boolean),
                     sa.column("created_at", sa.DateTime(timezone=True)),
                     sa.column("updated_at", sa.DateTime(timezone=True)))
    role_permissions = sa.table("role_permissions", sa.column("role_id", sa.Uuid), sa.column("permission_id", sa.Uuid))

    perm_ids = {code: uuid.uuid4() for code in PERMISSIONS}
    op.bulk_insert(permissions, [{"id": perm_ids[c], "code": c, "description": d} for c, d in PERMISSIONS.items()])
    now = sa.func.now()
    for name, (description, perms) in ROLES.items():
        role_id = uuid.uuid4()
        conn.execute(roles.insert().values(id=role_id, tenant_id=None, name=name, description=description,
                                           is_system=True, created_at=now, updated_at=now))
        op.bulk_insert(role_permissions, [{"role_id": role_id, "permission_id": perm_ids[p]} for p in sorted(perms)])

    op.execute(AUDIT_GUARD_FUNCTION)
    op.execute("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs")
    op.execute("CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs "
               "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()")
    op.execute("CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs "
               "FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only()")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.execute("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_system)")
    op.execute("DELETE FROM roles WHERE is_system AND tenant_id IS NULL")
    op.execute("DELETE FROM permissions")
