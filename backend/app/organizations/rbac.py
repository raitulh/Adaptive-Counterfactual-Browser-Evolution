"""Canonical RBAC catalogue. The migration seeds these rows; code refers to the constants."""

from __future__ import annotations

from app.common.enums import SystemRole


class P:
    TASKS_CREATE = "tasks:create"
    TASKS_READ = "tasks:read"
    TASKS_READ_ALL = "tasks:read_all"
    TASKS_CANCEL = "tasks:cancel"
    APPROVALS_DECIDE = "approvals:decide"
    APPROVALS_DECIDE_ANY = "approvals:decide_any"
    AGENTS_READ = "agents:read"
    AGENTS_MANAGE = "agents:manage"
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    TOOLS_READ = "tools:read"
    TOOLS_MANAGE = "tools:manage"
    INTEGRATIONS_MANAGE = "integrations:manage"
    AUTOMATIONS_MANAGE = "automations:manage"
    FILES_READ = "files:read"
    FILES_WRITE = "files:write"
    AUDIT_READ = "audit:read"
    USAGE_READ = "usage:read"
    MEMBERS_MANAGE = "members:manage"
    ORG_MANAGE = "org:manage"
    MCP_MANAGE = "mcp:manage"
    BILLING_MANAGE = "billing:manage"
    EXPERIMENTS_MANAGE = "experiments:manage"


PERMISSION_DESCRIPTIONS: dict[str, str] = {
    P.TASKS_CREATE: "Create agent tasks",
    P.TASKS_READ: "Read own tasks",
    P.TASKS_READ_ALL: "Read all tasks in the organization",
    P.TASKS_CANCEL: "Cancel/pause/resume own tasks",
    P.APPROVALS_DECIDE: "Approve or reject actions on own tasks",
    P.APPROVALS_DECIDE_ANY: "Approve or reject actions on any task in the organization",
    P.AGENTS_READ: "Read agents",
    P.AGENTS_MANAGE: "Create and version agents",
    P.MEMORY_READ: "Read own memories",
    P.MEMORY_WRITE: "Create and delete own memories",
    P.TOOLS_READ: "List tools",
    P.TOOLS_MANAGE: "Manage organization tool policies and credentials",
    P.INTEGRATIONS_MANAGE: "Connect and disconnect own integrations",
    P.AUTOMATIONS_MANAGE: "Create and manage automations",
    P.FILES_READ: "Read files",
    P.FILES_WRITE: "Upload and delete files",
    P.AUDIT_READ: "Read the organization audit log",
    P.USAGE_READ: "Read usage",
    P.MEMBERS_MANAGE: "Invite, remove and change roles of members",
    P.ORG_MANAGE: "Manage organization settings and policy",
    P.MCP_MANAGE: "Register and approve MCP servers",
    P.BILLING_MANAGE: "Manage billing",
    P.EXPERIMENTS_MANAGE: "Manage experiments and ACBE strategy promotion",
}

_MEMBER = {
    P.TASKS_CREATE, P.TASKS_READ, P.TASKS_CANCEL, P.APPROVALS_DECIDE, P.AGENTS_READ, P.AGENTS_MANAGE,
    P.MEMORY_READ, P.MEMORY_WRITE, P.TOOLS_READ, P.INTEGRATIONS_MANAGE, P.AUTOMATIONS_MANAGE,
    P.FILES_READ, P.FILES_WRITE, P.USAGE_READ,
}
_VIEWER = {P.TASKS_READ, P.AGENTS_READ, P.MEMORY_READ, P.TOOLS_READ, P.FILES_READ}
_ADMIN = _MEMBER | {
    P.TASKS_READ_ALL, P.APPROVALS_DECIDE_ANY, P.TOOLS_MANAGE, P.AUDIT_READ, P.MEMBERS_MANAGE, P.ORG_MANAGE,
    P.MCP_MANAGE, P.EXPERIMENTS_MANAGE,
}
_OWNER = _ADMIN | {P.BILLING_MANAGE}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    SystemRole.OWNER.value: _OWNER,
    SystemRole.ADMIN.value: _ADMIN,
    SystemRole.MEMBER.value: _MEMBER,
    SystemRole.VIEWER.value: _VIEWER,
}
