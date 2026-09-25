import type { EventOutcome } from "@/lib/schemas/dashboard";

/** Centralized TanStack Query keys so invalidation stays consistent. */
export const queryKeys = {
  me: ["auth", "me"] as const,
  overview: ["dashboard", "overview"] as const,
  events: (limit: number) => ["dashboard", "events", limit] as const,
  sessions: (outcome: EventOutcome | "all") => ["dashboard", "sessions", outcome] as const,
  logs: (limit: number) => ["dashboard", "logs", limit] as const,
  apiKeys: ["api-keys"] as const,
  webhooks: ["webhooks"] as const,
  settings: ["project", "settings"] as const,
};
