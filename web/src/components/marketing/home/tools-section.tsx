import {
  AppWindowIcon,
  BlocksIcon,
  BrainIcon,
  CalendarIcon,
  ContactIcon,
  FileTextIcon,
  GlobeIcon,
  HardDriveIcon,
  MailIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Section, SectionHeader } from "../primitives";

interface ToolEntry {
  name: string;
  icon: LucideIcon;
  summary: string;
  tools: string[];
  /** What the product enforces for this tool family (accurate to the backend). */
  guard: { label: string; tone: "warning" | "verify" | "neutral" | "recover" };
  span?: string;
}

const TOOLS: ToolEntry[] = [
  {
    name: "Gmail",
    icon: MailIcon,
    summary:
      "Search, read, draft and send. Sending always needs your approval; delivery is confirmed by the provider and read back.",
    tools: ["gmail.search", "gmail.read_message", "gmail.create_draft", "gmail.send"],
    guard: { label: "send → approval + read-back", tone: "warning" },
    span: "lg:col-span-2",
  },
  {
    name: "Calendar",
    icon: CalendarIcon,
    summary:
      "Find free slots, create, move and cancel events. Invites to other people need approval; every write is read back.",
    tools: ["calendar.find_free_slots", "calendar.create_event", "calendar.update_event", "calendar.cancel_event"],
    guard: { label: "write → read_back", tone: "verify" },
    span: "lg:col-span-2",
  },
  {
    name: "Drive",
    icon: HardDriveIcon,
    summary: "Search and read your documents.",
    tools: ["drive.search", "drive.read_file"],
    guard: { label: "read · output schema", tone: "neutral" },
  },
  {
    name: "Contacts",
    icon: ContactIcon,
    summary: "Resolve people to real addresses before anything is sent.",
    tools: ["contacts.lookup"],
    guard: { label: "read", tone: "neutral" },
  },
  {
    name: "Web",
    icon: GlobeIcon,
    summary: "Fetch public pages through SSRF-safe egress. Content is treated as untrusted data.",
    tools: ["web.fetch"],
    guard: { label: "untrusted content", tone: "recover" },
  },
  {
    name: "Search",
    icon: SearchIcon,
    summary: "Web search with source citations, and search across your own documents.",
    tools: ["search.web", "documents.search"],
    guard: { label: "cited sources", tone: "neutral" },
  },
  {
    name: "Browser",
    icon: AppWindowIcon,
    summary: "Navigate, extract, click and fill in an isolated browser worker behind its own egress proxy.",
    tools: ["browser.navigate", "browser.extract", "browser.click", "browser.fill"],
    guard: { label: "isolated worker", tone: "neutral" },
    span: "lg:col-span-2",
  },
  {
    name: "Files",
    icon: FileTextIcon,
    summary: "Read uploaded files and write new text, Markdown or CSV files.",
    tools: ["files.list", "files.read_text", "files.write_text"],
    guard: { label: "scanned uploads", tone: "neutral" },
  },
  {
    name: "Memory",
    icon: BrainIcon,
    summary: "Recall preferences, contacts and verified facts; remember what matters.",
    tools: ["memory.search", "memory.save"],
    guard: { label: "confidence + freshness", tone: "neutral" },
  },
  {
    name: "MCP servers",
    icon: BlocksIcon,
    summary: "Any tool with an MCP server — enabled per tool by an admin, re-reviewed when its schema changes.",
    tools: ["<server>.<tool>"],
    guard: { label: "admin-approved", tone: "warning" },
    span: "lg:col-span-2",
  },
];

const GUARD_TONE = {
  warning: "border-warning/25 text-warning",
  verify: "border-verify/25 text-verify",
  recover: "border-recover/25 text-recover",
  neutral: "border-line-strong text-fg-muted",
} as const;

export function ToolsSection() {
  return (
    <Section id="tools" aria-labelledby="tools-title" className="border-t border-line">
      <SectionHeader
        index="03"
        eyebrow="Tool ecosystem"
        title={<span id="tools-title">Works where your work already lives.</span>}
        lede="Built-in adapters for Google Workspace, the web, an isolated browser, files, search and memory — plus anything you connect over MCP. Every tool declares what it touches, how risky it is and how its result is verified."
      />
      <ul className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Built-in tools">
        {TOOLS.map((t) => (
          <li key={t.name} className={cn("group", t.span)} data-reveal>
            <Panel className="flex h-full flex-col gap-4 p-5 transition-colors duration-300 hover:border-line-strong hover:bg-surface-2/70">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted transition-colors group-hover:text-accent">
                  <t.icon className="size-4" aria-hidden />
                </span>
                <h3 className="text-[15px] font-semibold tracking-tight text-fg">{t.name}</h3>
                <span
                  className={cn(
                    "ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide",
                    GUARD_TONE[t.guard.tone],
                  )}
                >
                  {t.guard.label}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-fg-muted">{t.summary}</p>
              <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
                {t.tools.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </p>
            </Panel>
          </li>
        ))}
      </ul>
    </Section>
  );
}
