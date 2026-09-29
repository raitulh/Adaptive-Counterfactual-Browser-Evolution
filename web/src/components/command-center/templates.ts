/**
 * Composer templates, slash commands and request building (pure).
 *
 * Templates contain [bracketed placeholders]; after inserting one, the composer selects the first
 * placeholder and Tab jumps to the next, so a template is filled in without touching the mouse.
 */
import type { TaskCreate } from "@/lib/api";

export type SlashCommandId = "research" | "schedule" | "analyze" | "email" | "automate";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  description: string;
  template: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "research",
    label: "Research",
    description: "Investigate a topic and summarize it with sources",
    template: "Research [topic] and summarize the key findings, with sources I can check.",
  },
  {
    id: "schedule",
    label: "Schedule",
    description: "Find a free slot, create the event, confirm by e-mail",
    template: "Schedule a [30-minute] meeting with [person] [tomorrow after 2 PM] and email them a confirmation.",
  },
  {
    id: "analyze",
    label: "Analyze",
    description: "Analyze an attached file or dataset",
    template: "Analyze [the attached file] and summarize the key numbers, trends and anything unusual.",
  },
  {
    id: "email",
    label: "Email",
    description: "Draft or send an e-mail (sending asks you first)",
    template: "Draft an email to [person] about [subject].",
  },
  {
    id: "automate",
    label: "Automate",
    description: "Describe a workflow (recurring runs live in Automations)",
    template: "Every time [trigger], [do something] and [tell me the result].",
  },
];

export interface QuickAction {
  id: SlashCommandId;
  label: string;
  /** Navigates instead of inserting a template. */
  href?: string;
  /** Also open the file picker. */
  attach?: boolean;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "research", label: "Research something" },
  { id: "schedule", label: "Schedule a meeting" },
  { id: "analyze", label: "Analyze a file", attach: true },
  { id: "email", label: "Manage email" },
  { id: "automate", label: "Automate a workflow", href: "/app/automations" },
];

export function commandById(id: SlashCommandId): SlashCommand {
  return SLASH_COMMANDS.find((c) => c.id === id)!;
}

/**
 * The slash-command query at the caret: "/sch|" → "sch". Only when the "/" starts the text or a
 * line and the token has no spaces. Returns null otherwise.
 */
export function slashQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\n)\/([a-z]*)$/i.exec(before);
  if (!match) return null;
  return { query: match[2].toLowerCase(), start: before.length - match[2].length - 1 };
}

export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.id.startsWith(q) || c.label.toLowerCase().startsWith(q));
}

/** Replace the "/query" token (from `start` to `caret`) with the command's template. */
export function applyCommand(text: string, start: number, caret: number, command: SlashCommand): { text: string; selection: { start: number; end: number } } {
  const next = text.slice(0, start) + command.template + text.slice(caret);
  const ph = nextPlaceholder(next, start);
  const end = start + command.template.length;
  return { text: next, selection: ph ?? { start: end, end } };
}

/** The next [placeholder] at or after `from` (wrapping to the start). */
export function nextPlaceholder(text: string, from: number): { start: number; end: number } | null {
  const re = /\[[^\]\n]{1,60}\]/g;
  let first: { start: number; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hit = { start: m.index, end: m.index + m[0].length };
    first ??= hit;
    if (hit.start >= from) return hit;
  }
  return first;
}

export function hasPlaceholders(text: string): boolean {
  return /\[[^\]\n]{1,60}\]/.test(text);
}

export interface AttachedFile {
  id: string;
  filename: string;
}

export const CONTEXT_MAX = 8000;

/**
 * TaskCreate has no file field: uploaded files are referenced in `context` so the planner can read
 * them with its file tools (`files.read_text` takes a file_id).
 */
export function buildContext(context: string, files: readonly AttachedFile[]): string | null {
  const parts: string[] = [];
  if (context.trim()) parts.push(context.trim());
  if (files.length) parts.push(`Attached files: ${files.map((f) => `${f.filename} (file_id ${f.id})`).join(", ")}`);
  return parts.length ? parts.join("\n\n") : null;
}

export interface ComposerValues {
  goal: string;
  context: string;
  agentId: string | null;
  priority: number;
  maxDurationSeconds: number | null;
  files: readonly AttachedFile[];
}

export function buildTaskCreate(v: ComposerValues): TaskCreate {
  const body: TaskCreate = { goal: v.goal.trim(), priority: v.priority };
  const context = buildContext(v.context, v.files);
  if (context) body.context = context;
  if (v.agentId) body.agent_id = v.agentId;
  if (v.maxDurationSeconds) body.max_duration_seconds = v.maxDurationSeconds;
  return body;
}

export const PRIORITIES = [
  { value: 50, label: "High", hint: "Runs before normal tasks" },
  { value: 100, label: "Normal", hint: "Default" },
  { value: 200, label: "Low", hint: "Runs when workers are free" },
] as const;

export const DURATION_LIMITS = [
  { value: 0, label: "Agent default" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 4 * 3600, label: "4 hours" },
  { value: 24 * 3600, label: "1 day" },
] as const;
