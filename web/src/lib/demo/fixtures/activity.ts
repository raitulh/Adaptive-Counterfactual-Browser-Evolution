/** Audit entries and notifications that are not produced by the seeded task history. */
import type { DemoStore } from "../server/store";
import { DAY, HOUR, iso, MINUTE, seedId } from "../server/util";
import { AGENT_IDS } from "./agents";
import { AUTOMATION_IDS } from "./automations";
import { GOOGLE_CONNECTION_ID, MCP_SERVER_IDS } from "./integrations";

export function seedActivity(store: DemoStore, now: number): void {
  const me = store.me.id;
  const sara = store.members[1].user_id;
  let n = 0;
  const audit = (at: number, category: string, action: string, extra: Record<string, unknown> = {}) =>
    store.auditLog.push({
      id: seedId(0x60, ++n),
      tenant_id: store.org.id,
      user_id: me,
      actor_type: "user",
      status: "success",
      category,
      action,
      approval_id: null,
      ip_address: "203.0.113.24",
      request_id: `req_${(0x5eed00 + n).toString(16)}`,
      resource_id: null,
      resource_type: null,
      result_summary: null,
      step_id: null,
      task_id: null,
      tool_name: null,
      metadata: {},
      created_at: iso(at),
      ...extra,
    });
  audit(now - 58 * DAY, "integration", "integration.connected", {
    resource_type: "connection",
    resource_id: GOOGLE_CONNECTION_ID,
    metadata: { provider: "google", capabilities: 6 },
  });
  audit(now - 46 * DAY, "admin", "agent.create", { resource_type: "agent", resource_id: AGENT_IDS.assistant });
  audit(now - 40 * DAY, "automation", "automation.create", {
    resource_type: "automation",
    resource_id: AUTOMATION_IDS.digest,
  });
  audit(now - 33 * DAY, "admin", "member.add", {
    resource_type: "membership",
    metadata: { email: "priya.nair@agentos.example.com", role: "member" },
  });
  audit(now - 21 * DAY, "admin", "agent.version.create", {
    resource_type: "agent",
    resource_id: AGENT_IDS.assistant,
    metadata: { version_number: 2 },
  });
  audit(now - 19 * DAY, "admin", "mcp.server.approve", {
    resource_type: "mcp_server",
    resource_id: MCP_SERVER_IDS.linear,
  });
  audit(now - 14 * DAY, "admin", "organization.policy.update", {
    resource_type: "organization",
    resource_id: store.org.id,
    metadata: { policy_version: 4 },
  });
  audit(now - 12 * DAY, "admin", "member.add", {
    resource_type: "membership",
    metadata: { email: "finance@agentos.example.com", role: "viewer" },
  });
  audit(now - 3 * DAY, "admin", "agent.version.create", {
    resource_type: "agent",
    resource_id: AGENT_IDS.assistant,
    metadata: { version_number: 3 },
  });
  audit(now - 26 * HOUR, "admin", "mcp.server.register", {
    user_id: sara,
    resource_type: "mcp_server",
    resource_id: MCP_SERVER_IDS.wiki,
    ip_address: "198.51.100.44",
  });
  audit(now - 9 * HOUR, "security", "auth.login_failed", {
    user_id: null,
    status: "failure",
    ip_address: "192.0.2.201",
    metadata: { email: "demo@agentos.example.com", reason: "invalid_credentials" },
  });
  audit(now - 4 * MINUTE, "auth", "auth.login", { metadata: { method: "password", device: "Chrome on macOS" } });

  const note = (at: number, event: string, title: string, body: string, data: Record<string, unknown>, read: boolean) =>
    store.notifications.push({
      id: seedId(0x61, ++n),
      userId: me,
      idemKey: `seed:${n}`,
      channel: "in_app",
      event_type: event,
      title,
      body,
      data,
      status: "delivered",
      read_at: read ? iso(at + 20 * MINUTE) : null,
      created_at: iso(at),
    });
  note(
    now - 5 * DAY,
    "automation_failed",
    "Automation “Friday calendar review” failed",
    "The external service is temporarily unavailable. The next run is scheduled as usual.",
    { automation_id: AUTOMATION_IDS.weekly },
    true,
  );
  note(
    now - 9 * HOUR,
    "security_alert",
    "Failed sign-in attempt",
    "Someone tried to sign in to your account from a new location (192.0.2.201). If this wasn't you, change your password.",
    {},
    false,
  );
}
