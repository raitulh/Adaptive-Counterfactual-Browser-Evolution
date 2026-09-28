"""Plan catalogue and entitlements. The single place plan rules live; domain code asks
the usage/entitlement services, never checks plan names itself."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.usage.models import UsageKind


@dataclass(frozen=True, slots=True)
class Plan:
    name: str
    display_name: str
    monthly_quotas: dict[str, float] = field(default_factory=dict)
    features: frozenset[str] = frozenset()
    max_concurrent_tasks: int = 3
    max_automations: int = 3
    max_members: int = 1
    overage_allowed: bool = False


PLANS: dict[str, Plan] = {
    "free": Plan(
        name="free", display_name="Free",
        monthly_quotas={UsageKind.TASK_CREATED: 200, UsageKind.MODEL_CALL: 2_000, UsageKind.TOOL_CALL: 5_000,
                        UsageKind.BROWSER_SECONDS: 1_800, UsageKind.SEARCH_QUERY: 300,
                        UsageKind.AUTOMATION_RUN: 300},
        features=frozenset({"gmail", "calendar", "drive", "memory", "search"}),
        max_concurrent_tasks=3, max_automations=3, max_members=1,
    ),
    "pro": Plan(
        name="pro", display_name="Pro",
        monthly_quotas={UsageKind.TASK_CREATED: 5_000, UsageKind.MODEL_CALL: 50_000, UsageKind.TOOL_CALL: 100_000,
                        UsageKind.BROWSER_SECONDS: 36_000, UsageKind.SEARCH_QUERY: 10_000,
                        UsageKind.AUTOMATION_RUN: 10_000},
        features=frozenset({"gmail", "calendar", "drive", "memory", "search", "browser", "mcp", "automations"}),
        max_concurrent_tasks=10, max_automations=50, max_members=1, overage_allowed=True,
    ),
    "team": Plan(
        name="team", display_name="Team",
        monthly_quotas={UsageKind.TASK_CREATED: 50_000, UsageKind.MODEL_CALL: 500_000,
                        UsageKind.TOOL_CALL: 1_000_000, UsageKind.BROWSER_SECONDS: 360_000,
                        UsageKind.SEARCH_QUERY: 100_000, UsageKind.AUTOMATION_RUN: 100_000},
        features=frozenset({"gmail", "calendar", "drive", "memory", "search", "browser", "mcp", "automations",
                            "rbac", "audit_export"}),
        max_concurrent_tasks=50, max_automations=500, max_members=100, overage_allowed=True,
    ),
    "enterprise": Plan(
        name="enterprise", display_name="Enterprise", monthly_quotas={},
        features=frozenset({"gmail", "calendar", "drive", "memory", "search", "browser", "mcp", "automations",
                            "rbac", "audit_export", "sso", "data_residency"}),
        max_concurrent_tasks=500, max_automations=10_000, max_members=100_000, overage_allowed=True,
    ),
}


def get_plan(name: str) -> Plan:
    return PLANS.get(name, PLANS["free"])
