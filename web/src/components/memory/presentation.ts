/**
 * Presentation for Memory OS, derived from backend values (app/memory/models.py, service.py).
 *
 * The backend decides freshness (`fresh | stale | unverified`); the UI only renders it and never
 * upgrades a memory's trust. Uncertain memories (stale, unverified, conflicted, superseded) are
 * visibly marked: dimmed, dashed border and an explicit tag — never color alone.
 */
import {
  BookOpenIcon,
  BrainCircuitIcon,
  ClockIcon,
  ContactIcon,
  HistoryIcon,
  MessagesSquareIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import type { MemoryOut, MemoryType } from "@/lib/api";
import type { Tone } from "@/lib/status";

export type Freshness = MemoryOut["freshness"];

export interface MemoryTypeMeta {
  label: string;
  /** Section title. */
  section: string;
  description: string;
  icon: LucideIcon;
  /** Backend MAX_AGE: not re-verified within this window → "stale". */
  maxAgeDays: number;
}

export const memoryTypeMeta: Record<MemoryType, MemoryTypeMeta> = {
  long_term: {
    label: "Long-term",
    section: "Long-term",
    description: "Durable facts about you and your work.",
    icon: BrainCircuitIcon,
    maxAgeDays: 365,
  },
  preference: {
    label: "Preference",
    section: "Preferences",
    description: "How you like things done — meeting lengths, tone, tools.",
    icon: SlidersHorizontalIcon,
    maxAgeDays: 365,
  },
  verified_fact: {
    label: "Verified fact",
    section: "Verified facts",
    description: "Facts confirmed against a trusted source. They go stale fastest.",
    icon: ShieldCheckIcon,
    maxAgeDays: 90,
  },
  contact: {
    label: "Contact",
    section: "Contacts",
    description: "People and how to reach them. Low-confidence contacts are never used as recipients.",
    icon: ContactIcon,
    maxAgeDays: 180,
  },
  task_history: {
    label: "Task history",
    section: "Task history",
    description: "Outcomes of past tasks that inform future ones.",
    icon: HistoryIcon,
    maxAgeDays: 90,
  },
  semantic: {
    label: "Semantic",
    section: "Semantic",
    description: "General knowledge and context about your workspace.",
    icon: BookOpenIcon,
    maxAgeDays: 365,
  },
  short_term: {
    label: "Short-term",
    section: "Short-term",
    description: "Working context that expires after a day.",
    icon: ClockIcon,
    maxAgeDays: 1,
  },
  conversational: {
    label: "Conversational",
    section: "Conversational",
    description: "Recent conversational context; expires after a week.",
    icon: MessagesSquareIcon,
    maxAgeDays: 7,
  },
};

/** The primary sections of Memory OS (each maps 1:1 to a backend MemoryType). */
export const PRIMARY_SECTIONS: MemoryType[] = [
  "long_term",
  "preference",
  "verified_fact",
  "contact",
  "task_history",
  "semantic",
];
/** Short-lived layers, shown under "More". */
export const SECONDARY_SECTIONS: MemoryType[] = ["short_term", "conversational"];

export function metaForType(type: string): MemoryTypeMeta {
  return (
    (memoryTypeMeta as Record<string, MemoryTypeMeta>)[type] ?? {
      label: type,
      section: type,
      description: "",
      icon: BrainCircuitIcon,
      maxAgeDays: 365,
    }
  );
}

export interface FreshnessMeta {
  label: string;
  tone: Tone;
  description: string;
  uncertain: boolean;
}

export const freshnessMeta: Record<Freshness, FreshnessMeta> = {
  fresh: {
    label: "Fresh",
    tone: "success",
    description: "Confident and verified within its freshness window.",
    uncertain: false,
  },
  stale: {
    label: "Stale",
    tone: "warning",
    description: "Not re-verified recently. Agents treat it as a hint to confirm, not as ground truth.",
    uncertain: true,
  },
  unverified: {
    label: "Unverified",
    tone: "recover",
    description: "Low confidence or in conflict with another memory. Agents confirm before relying on it.",
    uncertain: true,
  },
};

/** Backend UNVERIFIED_BELOW = 0.5 */
export const UNVERIFIED_BELOW = 0.5;

export function confidenceLevel(confidence: number): { level: "high" | "medium" | "low"; label: string; tone: Tone } {
  if (confidence >= 0.8) return { level: "high", label: "High confidence", tone: "success" };
  if (confidence >= UNVERIFIED_BELOW) return { level: "medium", label: "Medium confidence", tone: "info" };
  return { level: "low", label: "Low confidence", tone: "warning" };
}

export const memoryStatusMeta: Record<string, { label: string; tone: Tone; description: string }> = {
  active: { label: "Active", tone: "neutral", description: "In use." },
  conflicted: {
    label: "Conflicted",
    tone: "recover",
    description: "Contradicts another memory about the same subject. Verify it to keep this value.",
  },
  superseded: {
    label: "Superseded",
    tone: "neutral",
    description: "Replaced by a newer or more trusted memory. Agents no longer use it.",
  },
};

export interface MemoryPresentation {
  freshness: FreshnessMeta;
  confidence: ReturnType<typeof confidenceLevel>;
  /** Render with reduced emphasis + dashed border. */
  uncertain: boolean;
  /** Explicit tags that carry the uncertainty in text. */
  tags: { label: string; tone: Tone; description: string }[];
  canVerify: boolean;
}

export function presentMemory(m: {
  freshness: Freshness;
  confidence: number;
  status?: string | null;
}): MemoryPresentation {
  const freshness = freshnessMeta[m.freshness] ?? freshnessMeta.unverified;
  const status = m.status ?? "active";
  const tags: MemoryPresentation["tags"] = [];
  if (status === "superseded")
    tags.push({ label: "Superseded", tone: "neutral", description: memoryStatusMeta.superseded.description });
  if (status === "conflicted")
    tags.push({ label: "Conflicted", tone: "recover", description: memoryStatusMeta.conflicted.description });
  if (m.freshness !== "fresh" && !(status === "conflicted" && m.freshness === "unverified")) {
    tags.push({ label: freshness.label, tone: freshness.tone, description: freshness.description });
  }
  return {
    freshness,
    confidence: confidenceLevel(m.confidence),
    uncertain: freshness.uncertain || status !== "active",
    tags,
    canVerify: status !== "superseded",
  };
}

export const SOURCE_LABELS: Record<string, string> = {
  user_stated: "You told AgentOS",
  task: "Saved during a task",
  tool_result: "From a tool result",
  extraction: "Learned from a task",
  import: "Imported",
};

/** Where a memory came from, with a link when the source is a task. */
export function describeSource(
  sourceType: string,
  sourceReference: string,
): { label: string; href?: string; taskId?: string } {
  const label = SOURCE_LABELS[sourceType] ?? sourceType.replace(/_/g, " ");
  const task = /^task:([0-9a-f-]{8,})$/i.exec(sourceReference ?? "");
  if (task) return { label, href: `/app/tasks/${task[1]}`, taskId: task[1] };
  return { label };
}

/**
 * How much of the type's freshness window has elapsed since the last verification (0 = just
 * verified, 1 = at/over the limit). Display only; the backend's `freshness` stays authoritative.
 */
export function freshnessWindow(
  memoryType: string,
  lastVerifiedAt: string,
  now: number,
): {
  elapsedDays: number;
  maxAgeDays: number;
  used: number;
  remainingDays: number;
} {
  const maxAgeDays = metaForType(memoryType).maxAgeDays;
  const t = new Date(lastVerifiedAt).getTime();
  const elapsedDays = Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : maxAgeDays;
  return {
    elapsedDays,
    maxAgeDays,
    used: Math.min(1, elapsedDays / maxAgeDays),
    remainingDays: Math.max(0, maxAgeDays - elapsedDays),
  };
}

export function formatDays(days: number): string {
  if (days < 1) return days * 24 < 1 ? "less than an hour" : `${Math.round(days * 24)} h`;
  const d = Math.round(days);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
