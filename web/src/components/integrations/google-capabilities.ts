/**
 * Google Workspace capability bundles accepted by `POST /integrations/google/connect`.
 *
 * The identifiers and their OAuth scopes mirror the backend's least-privilege map
 * (app/integrations/google/oauth.py → CAPABILITY_SCOPES). The OpenAPI contract only lists the
 * accepted identifiers in a description string (ConnectGoogleRequest.capabilities), so the web app
 * keeps this presentation table; the backend rejects unknown values with 422.
 */

export type GoogleProduct = "gmail" | "calendar" | "drive" | "contacts";

export interface GoogleCapability {
  id: string;
  product: GoogleProduct;
  label: string;
  /** What an agent can do with it, in plain words. */
  description: string;
  /** Exact OAuth scopes the backend requests for this capability. */
  scopes: string[];
  access: "read" | "write";
  /** Least-privilege note shown when relevant. */
  note?: string;
}

export const GOOGLE_PRODUCTS: Array<{ id: GoogleProduct; label: string; description: string }> = [
  { id: "gmail", label: "Gmail", description: "Search, read, draft and send e-mail." },
  { id: "calendar", label: "Google Calendar", description: "Find free time and manage events." },
  { id: "drive", label: "Google Drive", description: "Find and read files." },
  { id: "contacts", label: "Google Contacts", description: "Look up people's addresses." },
];

const G = "https://www.googleapis.com/auth/";

export const GOOGLE_CAPABILITIES: GoogleCapability[] = [
  {
    id: "gmail.read",
    product: "gmail",
    label: "Read mail",
    description: "Search and read messages and threads.",
    scopes: [`${G}gmail.readonly`],
    access: "read",
  },
  {
    id: "gmail.compose",
    product: "gmail",
    label: "Create drafts",
    description: "Create and update drafts for your review.",
    scopes: [`${G}gmail.compose`],
    access: "write",
    note: "Google's compose scope also permits sending drafts; AgentOS still requires approval before any send.",
  },
  {
    id: "gmail.send",
    product: "gmail",
    label: "Send mail",
    description: "Send messages on your behalf (each send needs approval).",
    scopes: [`${G}gmail.send`],
    access: "write",
  },
  {
    id: "calendar.read",
    product: "calendar",
    label: "Read calendars",
    description: "See events and free/busy information.",
    scopes: [`${G}calendar.readonly`],
    access: "read",
  },
  {
    id: "calendar.write",
    product: "calendar",
    label: "Manage events",
    description: "Create, update and cancel events.",
    scopes: [`${G}calendar.events`],
    access: "write",
    note: "Includes reading events.",
  },
  {
    id: "drive.read",
    product: "drive",
    label: "Read all files",
    description: "Search and read files in your Drive.",
    scopes: [`${G}drive.readonly`],
    access: "read",
  },
  {
    id: "drive.file",
    product: "drive",
    label: "Files AgentOS uses",
    description: "Only files created or opened with AgentOS.",
    scopes: [`${G}drive.file`],
    access: "write",
    note: "The narrowest Drive access — prefer it when agents don't need your existing files.",
  },
  {
    id: "contacts.read",
    product: "contacts",
    label: "Read contacts",
    description: "Look up names and e-mail addresses.",
    scopes: [`${G}contacts.readonly`],
    access: "read",
  },
];

export const GOOGLE_CAPABILITY_IDS = GOOGLE_CAPABILITIES.map((c) => c.id);

const byId = new Map(GOOGLE_CAPABILITIES.map((c) => [c.id, c]));
const byScope = new Map(GOOGLE_CAPABILITIES.flatMap((c) => c.scopes.map((s) => [s, c] as const)));

export function capability(id: string): GoogleCapability | undefined {
  return byId.get(id);
}

/** Capability bundle that requests `scope` (tools declare required scopes, the connect API takes capabilities). */
export function capabilityForScope(scope: string): GoogleCapability | undefined {
  return byScope.get(scope);
}

/** Capabilities needed to satisfy a tool's `required_scopes` (unknown scopes are ignored). */
export function capabilitiesForScopes(scopes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) {
    const c = byScope.get(s);
    if (c) out.add(c.id);
  }
  return GOOGLE_CAPABILITY_IDS.filter((id) => out.has(id));
}

/** Short, readable form of a scope URL: "https://www.googleapis.com/auth/gmail.send" → "gmail.send". */
export function shortScope(scope: string): string {
  return scope.startsWith(G) ? scope.slice(G.length) : scope;
}

/** Scopes the backend will request for a capability selection (OpenID identity scopes included). */
export function scopesForCapabilities(ids: readonly string[]): string[] {
  const scopes = ["openid", "email", "profile"];
  for (const id of ids) scopes.push(...(byId.get(id)?.scopes ?? []));
  return [...new Set(scopes)];
}

/** Keep a stable, canonical order and drop unknown values. */
export function sortCapabilities(ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return GOOGLE_CAPABILITY_IDS.filter((id) => set.has(id));
}
