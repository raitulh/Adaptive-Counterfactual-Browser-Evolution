/**
 * Query key factory — the single source of cache keys, so invalidation is precise and consistent.
 * Keys are scoped per resource; switching organization clears the whole cache (see AuthProvider).
 */
import type {
  ListApprovalsQuery,
  ListAuditQuery,
  ListCandidatesQuery,
  ListFilesQuery,
  ListMemoryQuery,
  ListNotificationsQuery,
  ListTasksQuery,
} from "@/lib/api";

export const qk = {
  me: ["me"] as const,
  myOrganizations: ["me", "organizations"] as const,

  organization: {
    all: ["organization"] as const,
    current: ["organization", "current"] as const,
    policy: ["organization", "policy"] as const,
    members: ["organization", "members"] as const,
  },

  sessions: ["auth", "sessions"] as const,

  tasks: {
    all: ["tasks"] as const,
    lists: ["tasks", "list"] as const,
    list: (q: ListTasksQuery = {}) => ["tasks", "list", q] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    events: (id: string) => ["tasks", "events", id] as const,
    summary: (id: string) => ["tasks", "summary", id] as const,
    logs: (id: string) => ["tasks", "logs", id] as const,
  },

  approvals: {
    all: ["approvals"] as const,
    list: (q: ListApprovalsQuery = {}) => ["approvals", "list", q] as const,
    pendingCount: ["approvals", "pending-count"] as const,
    detail: (id: string) => ["approvals", "detail", id] as const,
  },

  notifications: {
    all: ["notifications"] as const,
    list: (q: ListNotificationsQuery = {}) => ["notifications", "list", q] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },

  agents: {
    all: ["agents"] as const,
    list: ["agents", "list"] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    versions: (id: string) => ["agents", "versions", id] as const,
  },

  tools: {
    all: ["tools"] as const,
    list: ["tools", "list"] as const,
    policies: ["tools", "policies"] as const,
  },

  integrations: { all: ["integrations"] as const, list: ["integrations", "list"] as const },

  mcp: {
    all: ["mcp"] as const,
    servers: ["mcp", "servers"] as const,
    server: (id: string) => ["mcp", "server", id] as const,
    tools: (id: string) => ["mcp", "tools", id] as const,
  },

  memory: {
    all: ["memory"] as const,
    list: (q: ListMemoryQuery = {}) => ["memory", "list", q] as const,
    search: (q: unknown) => ["memory", "search", q] as const,
  },

  search: {
    web: (q: unknown) => ["search", "web", q] as const,
    documents: (q: unknown) => ["search", "documents", q] as const,
  },

  files: {
    all: ["files"] as const,
    list: (q: ListFilesQuery = {}) => ["files", "list", q] as const,
    detail: (id: string) => ["files", "detail", id] as const,
  },

  automations: {
    all: ["automations"] as const,
    list: ["automations", "list"] as const,
    detail: (id: string) => ["automations", "detail", id] as const,
    runs: (id: string) => ["automations", "runs", id] as const,
  },

  audit: { all: ["audit"] as const, list: (q: ListAuditQuery = {}) => ["audit", "list", q] as const },
  usage: (orgWide = false) => ["usage", { orgWide }] as const,
  billing: { plans: ["billing", "plans"] as const, entitlements: ["billing", "entitlements"] as const },

  evaluations: {
    all: ["evaluations"] as const,
    list: ["evaluations", "list"] as const,
    suites: ["evaluations", "suites"] as const,
    detail: (id: string) => ["evaluations", "detail", id] as const,
  },
  experiments: {
    all: ["experiments"] as const,
    list: ["experiments", "list"] as const,
    detail: (id: string) => ["experiments", "detail", id] as const,
  },
  acbe: {
    all: ["acbe"] as const,
    failures: ["acbe", "failures"] as const,
    candidates: (q: ListCandidatesQuery = {}) => ["acbe", "candidates", q] as const,
    candidate: (id: string) => ["acbe", "candidate", id] as const,
  },

  admin: {
    all: ["admin"] as const,
    system: ["admin", "system"] as const,
    users: (q: unknown) => ["admin", "users", q] as const,
    organizations: ["admin", "organizations"] as const,
    securityEvents: ["admin", "security-events"] as const,
    deadJobs: ["admin", "dead-jobs"] as const,
    usage: ["admin", "usage"] as const,
    featureFlags: ["admin", "feature-flags"] as const,
    task: (id: string) => ["admin", "task", id] as const,
  },
} as const;
