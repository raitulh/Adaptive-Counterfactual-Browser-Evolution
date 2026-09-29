/**
 * Presentation for tool catalogue values (verification methods, output trust, categories).
 * Values come from the backend (app/verification/types.py VerificationMethod, TrustLevel).
 */
import type { PermissionLevel, RiskLevel, ToolOut, TrustLevel } from "@/lib/api";
import { permissionLevelValues, riskLevelValues } from "@/lib/api";
import type { Tone } from "@/lib/status";

export const verificationMethodMeta: Record<string, { label: string; description: string }> = {
  read_back: {
    label: "Read-back",
    description: "AgentOS re-reads the external system after the call to confirm the change happened.",
  },
  state_comparison: {
    label: "State comparison",
    description: "The external state before and after the call is compared.",
  },
  expected_fields: {
    label: "Expected fields",
    description: "Specific fields of the result must match what was requested.",
  },
  resource_exists: { label: "Resource exists", description: "The created resource is looked up to confirm it exists." },
  provider_confirmation: {
    label: "Provider confirmation",
    description: "The provider's response (e.g. a message id) confirms the effect.",
  },
  browser_state: { label: "Browser state", description: "The page state is inspected after the browser action." },
  output_schema: {
    label: "Output schema",
    description: "The result must validate against the tool's declared output schema.",
  },
  checksum: { label: "Checksum", description: "Written content is verified by checksum." },
  response_consistency: {
    label: "Response consistency",
    description: "The response is checked for internal consistency.",
  },
};

export function verificationLabel(method: string): string {
  return verificationMethodMeta[method]?.label ?? method.replace(/_/g, " ");
}

export const outputTrustMeta: Record<TrustLevel, { label: string; tone: Tone; description: string }> = {
  trusted_system_logic: { label: "Trusted system logic", tone: "success", description: "Produced by AgentOS itself." },
  controlled_agent_output: {
    label: "Agent-controlled output",
    tone: "info",
    description: "Structured output shaped by the tool; safe to use as data.",
  },
  untrusted_external_content: {
    label: "Untrusted external content",
    tone: "warning",
    description:
      "Comes from outside (web pages, e-mails, files). Treated as data, never as instructions; side effects whose arguments derive from it always need approval.",
  },
};

export function outputTrust(value: string) {
  return (
    (outputTrustMeta as Record<string, (typeof outputTrustMeta)[TrustLevel]>)[value] ?? {
      label: value,
      tone: "neutral" as Tone,
      description: "",
    }
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  browser: "Browser",
  calendar: "Calendar",
  email: "Email",
  files: "Files",
  compute: "Compute",
  search: "Search",
  contacts: "Contacts",
  memory: "Memory",
  web: "Web",
  mcp: "MCP",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google Workspace",
  internal: "AgentOS",
  browser: "Isolated browser",
  model: "Model gateway",
  web_search: "Web search",
  web: "Web",
  mcp: "MCP",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function asPermissionLevel(v: string): PermissionLevel | null {
  return (permissionLevelValues as readonly string[]).includes(v) ? (v as PermissionLevel) : null;
}

export function asRiskLevel(v: string): RiskLevel | null {
  return (riskLevelValues as readonly string[]).includes(v) ? (v as RiskLevel) : null;
}

export interface ToolFilters {
  query: string;
  category: string; // "all" | category
  permission: string; // "all" | PermissionLevel
  approvalOnly: boolean;
}

export function filterTools(tools: readonly ToolOut[], f: ToolFilters): ToolOut[] {
  const q = f.query.trim().toLowerCase();
  return tools.filter((t) => {
    if (f.category !== "all" && t.category !== f.category) return false;
    if (f.permission !== "all" && t.permission_level !== f.permission) return false;
    if (f.approvalOnly && !t.requires_approval) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.provider.toLowerCase().includes(q) ||
      t.required_scopes.some((s) => s.toLowerCase().includes(q))
    );
  });
}

export function groupByCategory(tools: readonly ToolOut[]): Array<{ category: string; tools: ToolOut[] }> {
  const map = new Map<string, ToolOut[]>();
  for (const t of tools) {
    const list = map.get(t.category) ?? [];
    list.push(t);
    map.set(t.category, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b)))
    .map(([category, list]) => ({ category, tools: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}
