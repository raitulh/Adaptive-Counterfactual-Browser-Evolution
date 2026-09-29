import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { marketingMetadata } from "@/components/marketing/metadata";
import { DocSection, FactList, OnThisPage, PageHero } from "@/components/marketing/page-hero";
import { Container, Panel } from "@/components/marketing/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = marketingMetadata({
  title: "Security architecture",
  description:
    "How AgentOS keeps an acting AI safe: deterministic policy, action-bound approvals, read-back verification and reconciliation, tenant isolation, encrypted credentials, hardened sessions, append-only audit, SSRF-safe egress and an isolated browser.",
  path: "/security",
});

const TOC = [
  { id: "principles", label: "Trust model" },
  { id: "approvals", label: "Policy & approvals" },
  { id: "verification", label: "Verification & reconciliation" },
  { id: "isolation", label: "Tenant isolation" },
  { id: "encryption", label: "Credentials & encryption" },
  { id: "auth", label: "Authentication & sessions" },
  { id: "audit", label: "Audit & redaction" },
  { id: "egress", label: "SSRF-safe egress" },
  { id: "browser", label: "Isolated browser" },
  { id: "data", label: "Data handling" },
  { id: "limits", label: "Know the edges" },
];

const TRUST = [
  {
    level: "Trusted system logic",
    examples: "Platform policy, agent-version instructions, validated strategy hints",
    may: "Behaviour",
    tone: "text-fg",
  },
  {
    level: "Controlled",
    examples: "Your goal and answers, memories, provider-structured tool output",
    may: "What to do",
    tone: "text-fg-muted",
  },
  {
    level: "Untrusted external content",
    examples: "E-mail bodies, web pages, documents, search results, MCP output, browser observations",
    may: "Nothing — data only",
    tone: "text-recover",
  },
];

const POLICY_ORDER = [
  "The principal's role must allow creating tasks.",
  "Admin-level tools are never available to agents.",
  "Feature flags per tool category and per tool.",
  "Your organization's blocklist and the agent version's allow/deny lists.",
  "Destructive and financial tools need explicit organization opt-in and approval.",
  "High-risk writes — and any side effect of high risk — need approval.",
  "Organization tool rules: deny wins; allow can waive default approval only for bounded, non-destructive, untainted writes.",
  "Taint: arguments derived from untrusted content force approval for any side effect.",
  "The model's own label can escalate, never relax.",
];

const RETENTION = [
  ["Task events of finished tasks, automation runs", "180 days"],
  ["Execution logs, notifications", "90 days"],
  ["Usage events", "400 days"],
  ["Audit logs", "730 days"],
  ["Temporary files, browser artifacts", "7 days"],
  ["Soft-deleted memories", "30 days"],
];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security architecture"
        title={
          <>
            Built for an AI that acts
            <span className="block text-fg-muted">with real accounts.</span>
          </>
        }
        lede="AgentOS assumes model output, e-mails, web pages and third-party tools are untrusted, and that any single process can fail. Authority is computed by deterministic code from server-side state — and every claim of success is checked against the real system."
        actions={
          <Button asChild variant="primary" size="lg">
            <Link href="/signup">
              Start building <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        }
      />

      <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <OnThisPage items={TOC} className="sticky top-28" />
        </aside>
        <div className="flex min-w-0 flex-col gap-16">
          <DocSection
            id="principles"
            index="01"
            title="Authorization never reads model text."
            lede="Prompt-injection defences in the prompt are a mitigation. The defence is structural: permissions, approvals and policy are computed from server state, and data carries a provenance label that decides what it may influence."
          >
            <div className="overflow-hidden rounded-2xl border border-line">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Trust levels and what each may influence</caption>
                <thead className="bg-surface-2/60 font-mono text-[10.5px] tracking-[0.16em] text-fg-subtle uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-normal">
                      Level
                    </th>
                    <th scope="col" className="hidden px-5 py-3 font-normal md:table-cell">
                      Examples
                    </th>
                    <th scope="col" className="px-5 py-3 font-normal">
                      May influence
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface-1">
                  {TRUST.map((t) => (
                    <tr key={t.level}>
                      <th scope="row" className={cn("px-5 py-4 font-medium", t.tone)}>
                        {t.level}
                        <span className="mt-1 block text-xs font-normal text-fg-subtle md:hidden">{t.examples}</span>
                      </th>
                      <td className="hidden px-5 py-4 text-fg-muted md:table-cell">{t.examples}</td>
                      <td className="px-5 py-4 text-fg-muted">{t.may}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              Untrusted content is fenced off in the planner context and sanitized before storage. Any step whose
              arguments derive from it — or any step of a plan whose planner saw it — is{" "}
              <span className="text-warning">tainted</span>, and tainted side effects always require approval, even
              where an organization rule would waive it.
            </p>
          </DocSection>

          <DocSection
            id="approvals"
            index="02"
            title="Policy decides. Approvals are bound to the action."
            lede="A pure policy engine returns allow, require approval or deny with reasons — evaluated at planning time as a preview, and again at execution with the concrete, resolved arguments."
          >
            <Panel className="p-5">
              <p className="font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">Evaluation order</p>
              <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-fg-muted marker:font-mono marker:text-fg-subtle">
                {POLICY_ORDER.map((p) => (
                  <li key={p} className="pl-1">
                    {p}
                  </li>
                ))}
              </ol>
            </Panel>
            <FactList
              className="mt-4"
              items={[
                {
                  term: "Bound",
                  body: "Each approval carries a hash of the tool and its canonical resolved arguments. A different recipient or time needs a new approval.",
                },
                {
                  term: "Expiring",
                  body: "Pending approvals expire (your organization can set the window); resuming later requests a fresh one.",
                },
                {
                  term: "Single use",
                  body: "Execution consumes the approval with an atomic compare-and-set; a replay is refused.",
                },
                {
                  term: "Owner-only",
                  body: "Only the task owner — or an admin with the right permission — can decide. Others can't even see that it exists.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="verification"
            index="03"
            title="Verified, or not done."
            lede="The model cannot mark anything complete. Verifiers produce machine-readable evidence; a task completes only after a final check."
          >
            <FactList
              items={[
                {
                  term: "Read-back",
                  body: "Writes are re-read from the provider and compared field by field. Verifier errors are inconclusive — never a pass.",
                },
                {
                  term: "Idempotency ledger",
                  body: "Every side effect is registered before it happens. A known success is reused, not repeated.",
                },
                {
                  term: "Reconciliation",
                  body: "An ambiguous outcome (timeout, crash) is looked up at the provider — by deterministic event id or Message-ID — before any retry.",
                },
                {
                  term: "Human confirmation",
                  body: "If a write can't be verified automatically, the task stops in needs confirmation and asks you. It is never retried blindly.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="isolation"
            index="04"
            title="Tenant isolation in the data layer."
            lede="A tenant is an organization, and isolation is enforced by the ORM for every query — not by convention."
          >
            <FactList
              items={[
                {
                  term: "Tenant from the session",
                  body: "The tenant is derived from the verified session, never from client input.",
                },
                {
                  term: "Automatic scoping",
                  body: "Every read, update and delete on tenant-owned data is filtered by tenant; writes of another tenant's rows are refused.",
                },
                {
                  term: "Fail closed",
                  body: "A tenant-scoped query on an unscoped session raises an error instead of returning cross-tenant data.",
                },
                {
                  term: "Current membership",
                  body: "Workers re-derive the task owner's permissions on every run; a removed member's tasks stop.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="encryption"
            index="05"
            title="Credentials encrypted, never exposed."
            lede="OAuth tokens, MFA secrets and tool or MCP credentials are encrypted at rest and decrypted only where they are used."
          >
            <FactList
              items={[
                {
                  term: "Encryption at rest",
                  body: "Fernet (AES-128-CBC + HMAC-SHA256) with key rotation: the primary key encrypts, previous keys still decrypt.",
                },
                {
                  term: "One vault",
                  body: "A single credential vault decrypts provider tokens, refreshes them outside database transactions and marks expired or revoked connections.",
                },
                {
                  term: "Never returned",
                  body: "Tokens and credentials never appear in API responses, logs or audit metadata.",
                },
                {
                  term: "Least privilege",
                  body: "Google scopes are requested incrementally, per capability — read, send, calendar write — as you need them.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="auth"
            index="06"
            title="Authentication and sessions."
            lede="Sessions are designed on the assumption that someone will eventually try to steal one."
          >
            <FactList
              items={[
                {
                  term: "Passwords",
                  body: "Argon2id hashing, strength rules, rate limits and a database-backed lockout that survives a cache outage. No account enumeration.",
                },
                {
                  term: "HttpOnly refresh",
                  body: "In the browser, the refresh token lives in an HttpOnly, SameSite=Strict cookie; access tokens stay in memory and expire in minutes.",
                },
                {
                  term: "Rotation & reuse detection",
                  body: "Refresh tokens rotate on every use; presenting an old one revokes the whole session.",
                },
                { term: "CSRF", body: "Refreshing requires a double-submit CSRF token." },
                {
                  term: "MFA",
                  body: "TOTP multi-factor authentication with an encrypted secret; disabling it requires a valid code.",
                },
                {
                  term: "Sign in with Google",
                  body: "Authorization code flow with PKCE, a single-use state, a nonce and full ID-token verification.",
                },
                {
                  term: "Streams without tokens in URLs",
                  body: "Live streams use short-lived stream tokens; full access tokens are refused in URLs.",
                },
                {
                  term: "RBAC",
                  body: "Viewer, member, admin and owner roles; resources you don't own answer 404, not 403.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="audit"
            index="07"
            title="An audit trail the database protects."
            lede="Audit records commit in the same transaction as the change they describe."
          >
            <FactList
              items={[
                {
                  term: "Append-only",
                  body: "A database trigger rejects UPDATE, DELETE and TRUNCATE on the audit log; only the audited retention job may purge old rows.",
                },
                {
                  term: "Complete context",
                  body: "Actor, tenant, task, step, tool, approval, request ID and trace ID on every record.",
                },
                {
                  term: "Secret redaction",
                  body: "Passwords, tokens, API keys, cookies and key material are removed from logs, audit metadata and approval previews.",
                },
                {
                  term: "Honest errors",
                  body: "Error responses carry a request ID — never stack traces or provider bodies.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="egress"
            index="08"
            title="SSRF-safe outbound traffic."
            lede="Every URL chosen by a model, a user, a web page or an MCP server goes through one egress policy."
          >
            <FactList
              items={[
                {
                  term: "Public addresses only",
                  body: "Hosts are resolved and every address must be public — loopback, private, link-local, metadata and reserved ranges are blocked.",
                },
                {
                  term: "No DNS rebinding",
                  body: "Connections go to the vetted IP, with the original Host header and TLS SNI preserved.",
                },
                { term: "Every hop", body: "Redirects are followed manually and re-vetted on each hop, up to five." },
                {
                  term: "Bounded",
                  body: "Only HTTP(S) on standard ports, no credentials in URLs, size-capped responses and timeouts on every call.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="browser"
            index="09"
            title="An isolated browser."
            lede="Browser automation runs only in dedicated browser workers — never in the API or the general workers."
          >
            <FactList
              items={[
                {
                  term: "Two layers of egress control",
                  body: "Request interception in the page plus a per-task authenticated proxy that Chromium is forced through.",
                },
                {
                  term: "Network policy",
                  body: "Browser workers run in their own pod whose network policy denies private and link-local ranges.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="data"
            index="10"
            title="Data handling."
            lede="Retention runs hourly in bounded batches, and you can delete your account at any time."
          >
            <div className="overflow-hidden rounded-2xl border border-line">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Default retention periods</caption>
                <thead className="bg-surface-2/60 font-mono text-[10.5px] tracking-[0.16em] text-fg-subtle uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-normal">
                      Data
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-normal">
                      Default retention
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface-1">
                  {RETENTION.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row" className="px-5 py-3 font-normal text-fg-muted">
                        {k}
                      </th>
                      <td className="px-5 py-3 text-right font-mono text-xs text-fg">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FactList
              className="mt-4"
              items={[
                {
                  term: "Right to delete",
                  body: "Deleting your account revokes every session immediately, revokes Google grants and purges memories, files, tasks and credentials.",
                },
                {
                  term: "Files",
                  body: "Server-generated storage keys, size limits, content sniffing and optional malware scanning that fails closed. Downloads use short-lived signed URLs.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="limits"
            index="11"
            title="Know the edges."
            lede="Security writing should say where the boundaries are. These are the current ones."
          >
            <ul className="flex flex-col gap-3 text-sm leading-relaxed text-fg-muted">
              {[
                "Cloud KMS envelope encryption is not implemented yet: encryption keys are supplied as secrets (for example from a secret manager) and can be rotated.",
                "In the provided container images Chromium's own sandbox is disabled; the container, the per-task egress proxy and the network policy are the isolation boundary.",
                "Network policies are CIDR-based; restricting egress by domain needs an egress gateway.",
                "E-mail reconciliation relies on the provider's search index; unusually slow indexing could, rarely, still allow one duplicate.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2.5 h-px w-3 shrink-0 bg-recover" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </DocSection>
        </div>
      </Container>
    </>
  );
}
