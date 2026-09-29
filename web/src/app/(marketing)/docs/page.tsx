import {
  ArrowUpRightIcon,
  BlocksIcon,
  BotIcon,
  BrainIcon,
  CalendarClockIcon,
  FileJsonIcon,
  HandIcon,
  KeyRoundIcon,
  ListTreeIcon,
  RadioIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { marketingMetadata } from "@/components/marketing/metadata";
import { DocSection, FactList, OnThisPage, PageHero } from "@/components/marketing/page-hero";
import { Container } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/data-display";
import { publicApiDocsUrl } from "@/lib/api/public";

export const metadata: Metadata = marketingMetadata({
  title: "Documentation",
  description:
    "AgentOS documentation hub: core concepts, an API quickstart (register, create a task, stream its events, approve an action), streaming, idempotency and the API reference.",
  path: "/docs",
});

const TOC = [
  { id: "concepts", label: "Concepts" },
  { id: "quickstart", label: "Quickstart" },
  { id: "streaming", label: "Streaming events" },
  { id: "idempotency", label: "Idempotency & errors" },
  { id: "reference", label: "API reference" },
];

const CONCEPTS: Array<{ icon: LucideIcon; title: string; body: string; href: string }> = [
  {
    icon: WorkflowIcon,
    title: "Tasks & lifecycle",
    body: "A goal becomes a task that moves through a strict state machine.",
    href: "/product#lifecycle",
  },
  {
    icon: ListTreeIcon,
    title: "Plans & steps",
    body: "Validated dependency graphs; data flows between steps by explicit references.",
    href: "/product#lifecycle",
  },
  {
    icon: HandIcon,
    title: "Policy & approvals",
    body: "Allow, require approval or deny — approvals bound to the exact action.",
    href: "/security#approvals",
  },
  {
    icon: ShieldCheckIcon,
    title: "Verification",
    body: "Read-back evidence, reconciliation, and completion only after a final check.",
    href: "/security#verification",
  },
  {
    icon: RadioIcon,
    title: "Events & streaming",
    body: "An ordered, gap-free event log, live over Server-Sent Events.",
    href: "#streaming",
  },
  {
    icon: KeyRoundIcon,
    title: "Idempotency",
    body: "Retry any create safely with an Idempotency-Key.",
    href: "#idempotency",
  },
  {
    icon: BrainIcon,
    title: "Memory",
    body: "Typed memories with confidence, freshness and conflict handling.",
    href: "/product#memory",
  },
  {
    icon: CalendarClockIcon,
    title: "Automations",
    body: "Cron-scheduled task templates with a failure policy.",
    href: "/product#automations",
  },
  {
    icon: BlocksIcon,
    title: "MCP servers",
    body: "Admin-approved tools with schema-change review.",
    href: "/product#tools",
  },
  {
    icon: BotIcon,
    title: "Agents & versions",
    body: "Immutable versions of instructions, policies and limits.",
    href: "/product#agents",
  },
];

const STEPS = [
  {
    title: "Create an account",
    body: "Registration creates your user and a personal organization, and returns an access token (15 minutes) and a rotating refresh token.",
    code: `API=https://your-agentos-host/api/v1

curl -s -X POST $API/auth/register \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"ada@example.com","password":"Str0ng!Passw0rd","display_name":"Ada"}' \\
  | tee tokens.json
TOKEN=$(jq -r .access_token tokens.json)`,
  },
  {
    title: "Create a task",
    body: "Send a goal. The API answers 202 Accepted; planning and execution happen in workers. Reuse the same Idempotency-Key if you retry.",
    code: `TASK=$(curl -s -X POST $API/tasks \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -H "Idempotency-Key: task-$(date +%s)" \\
  -d '{"goal":"Find a free 30-minute slot tomorrow, schedule a meeting with Rahim, and send a confirmation."}' \\
  | jq -r .task_id)`,
  },
  {
    title: "Stream its events",
    body: "Exchange your access token for a short-lived stream token (full tokens are refused in URLs), then follow the task live.",
    code: `STREAM=$(curl -s -X POST $API/auth/stream-token -H "Authorization: Bearer $TOKEN" | jq -r .token)
curl -N "$API/tasks/$TASK/events/stream?access_token=$STREAM"

# id: 20
# event: APPROVAL_REQUIRED
# data: {"seq": 20, "step_id": "…", "payload": {"approval_id": "…", "summary": "Create calendar event …", "risk_level": "high", "expires_at": "…"}}`,
  },
  {
    title: "Review and approve",
    body: "Pending approvals show the exact, redacted arguments they are bound to. Approve (or reject) — the step then runs, is verified, and the task continues.",
    code: `curl -s "$API/approvals?status=pending&task_id=$TASK" -H "Authorization: Bearer $TOKEN" \\
  | jq '.items[] | {id, tool_name, summary, risk_level, arguments_preview, expires_at}'

APPROVAL=$(curl -s "$API/approvals?status=pending&task_id=$TASK" -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')
curl -s -X POST $API/approvals/$APPROVAL/approve \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -H "Idempotency-Key: approve-$APPROVAL" -d '{"note":"looks right"}'`,
  },
  {
    title: "Read the verified result",
    body: "The summary is built from durable state: what changed (with external references), what was verified and how, what failed, and what is waiting on you.",
    code: `curl -s $API/tasks/$TASK/summary -H "Authorization: Bearer $TOKEN" | jq`,
  },
];

export default function DocsPage() {
  const apiDocs = publicApiDocsUrl();
  return (
    <>
      <PageHero
        eyebrow="Documentation"
        title={
          <>
            Build on AgentOS.
            <span className="block text-fg-muted">Keep every guarantee.</span>
          </>
        }
        lede="Everything in the product is available over a typed HTTP API: create tasks, stream their events, decide approvals, manage memory, automations, tools and agents. Start with the concepts, then run the quickstart."
        actions={
          <>
            <Button asChild variant="primary" size="lg">
              <a href="#quickstart">Quickstart</a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#reference">API reference</a>
            </Button>
          </>
        }
      />

      <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <OnThisPage items={TOC} className="sticky top-28" />
        </aside>
        <div className="flex min-w-0 flex-col gap-16">
          <DocSection id="concepts" index="01" title="Concepts." lede="The ideas every AgentOS integration builds on.">
            <ul className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
              {CONCEPTS.map((c) => (
                <li key={c.title} className="bg-surface-1">
                  <Link
                    href={c.href}
                    className="group flex h-full gap-4 p-5 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <c.icon
                      className="mt-0.5 size-5 shrink-0 text-fg-subtle transition-colors group-hover:text-accent"
                      aria-hidden
                    />
                    <span>
                      <span className="block text-[15px] font-semibold tracking-tight text-fg">{c.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-fg-muted">{c.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </DocSection>

          <DocSection
            id="quickstart"
            index="02"
            title="Quickstart: from goal to verified result."
            lede="Five calls with curl and jq. Replace the host with your AgentOS API; connect Google Workspace in the app (or via the integrations API) so the agent can use Calendar and Gmail."
          >
            <ol className="flex flex-col gap-10">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <div>
                    <p className="font-mono text-[10.5px] text-accent">STEP {i + 1}</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-fg">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.body}</p>
                  </div>
                  <CodeBlock className="min-w-0 bg-surface-1 [&_pre]:text-[12px]">{s.code}</CodeBlock>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection
            id="streaming"
            index="03"
            title="Streaming events."
            lede="Each task has an immutable, gap-free event log. The stream delivers it live; the REST endpoint pages through it."
          >
            <FactList
              items={[
                {
                  term: "Resumable",
                  body: "Every SSE message carries the event's sequence number as its id. Reconnect with Last-Event-ID to continue without gaps or duplicates.",
                },
                {
                  term: "Terminal event",
                  body: "An end event closes the stream once all events were delivered and the task finished.",
                },
                {
                  term: "Polling fallback",
                  body: "GET /tasks/{id}/events?after_seq=n returns the same events for clients that cannot use SSE.",
                },
                {
                  term: "Keep-alives",
                  body: "A comment line roughly every 15 seconds keeps proxies from closing idle streams.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="idempotency"
            index="04"
            title="Idempotency and errors."
            lede="Safe retries and one error shape across the whole API."
          >
            <FactList
              items={[
                {
                  term: "Idempotency-Key",
                  body: "Creates (tasks, approvals, memory, files, MCP servers, automations, evaluations) accept a key. A retry with the same key and body returns the stored response instead of repeating the operation.",
                },
                {
                  term: "Conflicts are explicit",
                  body: "The same key with a different body is rejected; a retry while the first request is still running gets 409.",
                },
                {
                  term: "One error envelope",
                  body: "Every error has a code, a message, a request_id and optional details — never stack traces or provider bodies.",
                },
                {
                  term: "Limits",
                  body: "Rate limits and plan quotas answer 429 with Retry-After and RateLimit headers.",
                },
              ]}
            />
            <CodeBlock className="mt-4 bg-surface-1" copy={false}>
              {`{"error": {"code": "approval_expired", "message": "The approval has expired.", "request_id": "3f9c…", "details": {}}}`}
            </CodeBlock>
          </DocSection>

          <DocSection
            id="reference"
            index="05"
            title="API reference."
            lede="The API is described by an OpenAPI document; the interactive reference is served by the API itself."
          >
            <ul className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
              <li className="bg-surface-1 p-5">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                  <ArrowUpRightIcon className="size-4 text-fg-subtle" aria-hidden /> Interactive reference
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                  Every endpoint, parameter and schema, with try-it-out. Served at{" "}
                  <code className="font-mono text-xs text-fg">/docs</code> on your API&apos;s origin (when the
                  deployment exposes it).
                </p>
                {apiDocs && (
                  <a
                    href={apiDocs}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
                  >
                    Open the API reference <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  </a>
                )}
              </li>
              <li className="bg-surface-1 p-5">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                  <FileJsonIcon className="size-4 text-fg-subtle" aria-hidden /> OpenAPI document
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                  Machine-readable schema for generating typed clients. Base path{" "}
                  <code className="font-mono text-xs text-fg">/api/v1</code>; authenticate with{" "}
                  <code className="font-mono text-xs text-fg">Authorization: Bearer</code>.
                </p>
                <a
                  href="/api/v1/openapi.json"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
                >
                  /api/v1/openapi.json <ArrowUpRightIcon className="size-3.5" aria-hidden />
                </a>
              </li>
            </ul>
          </DocSection>
        </div>
      </Container>
    </>
  );
}
