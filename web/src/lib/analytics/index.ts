/**
 * Product analytics abstraction. Provider-agnostic, privacy-first:
 *  - only a fixed set of product events;
 *  - properties are restricted to non-sensitive primitives (ids, counts, statuses, tool names);
 *  - never task goals, message content, emails, tokens or free text.
 * Configure with NEXT_PUBLIC_ANALYTICS_PROVIDER (none | console) or register a custom sink.
 */
import { env } from "@/lib/config/env";

export type AnalyticsEvent =
  | "user_registered"
  | "task_created"
  | "task_completed"
  | "task_failed"
  | "approval_created"
  | "approval_approved"
  | "approval_rejected"
  | "agent_created"
  | "agent_version_created"
  | "automation_created"
  | "automation_run_now"
  | "integration_connected"
  | "memory_created"
  | "file_uploaded"
  | "search_performed"
  | "command_palette_opened";

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsSink {
  track(event: AnalyticsEvent, props: AnalyticsProps): void;
}

const FORBIDDEN_KEYS = /goal|content|text|message|email|password|token|secret|query|body|answer|note|reason/i;

let sink: AnalyticsSink | null =
  env.analyticsProvider === "console"
    ? { track: (event, props) => console.info("[analytics]", event, props) }
    : null;

export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
}

export function sanitizeProps(props: AnalyticsProps = {}): AnalyticsProps {
  const out: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    if (typeof value === "string" && value.length > 80) continue; // no free text
    out[key] = value;
  }
  return out;
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!sink || typeof window === "undefined") return;
  try {
    sink.track(event, sanitizeProps(props));
  } catch {
    /* analytics must never break the product */
  }
}
