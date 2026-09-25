import type { Metadata } from "next";
import { DocsCode } from "@/components/docs/docs-code";
import { DocsNav, type DocsNavItem } from "@/components/docs/docs-nav";
import { DocsSection, DocsTable, Endpoint, InlineCode } from "@/components/docs/docs-section";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { MOCK_INVALID_PASSWORD, MOCK_SESSION_TTL_SECONDS } from "@/lib/api/mock/mock-api";
import {
  envSample,
  pythonSample,
  responseSample,
  restSample,
  serverSample,
  widgetSample,
} from "@/lib/constants/code-samples";
import { security, useCases } from "@/lib/constants/content";
import { siteConfig } from "@/lib/constants/site";
import { apiErrorCodeSchema } from "@/lib/schemas/api-error";
import { webhookEventTypeSchema } from "@/lib/schemas/dashboard";
import { DEFAULT_POLICY, SIGNAL_PASS_AT, SIGNAL_REVIEW_AT } from "@/lib/verification/scoring";
import { SIGNALS } from "@/lib/verification/signals";

export const metadata: Metadata = {
  title: "Documentation",
  description: `Integrate ${siteConfig.name}: quickstart, verification flow, API reference, signals, policies, webhooks and mock mode.`,
  ...(siteConfig.url ? { alternates: { canonical: "/docs" } } : {}),
};

const NAV: readonly DocsNavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "verification-flow", label: "Verification flow" },
  { id: "api-reference", label: "API reference" },
  { id: "signals", label: "Signals" },
  { id: "policies", label: "Policies" },
  { id: "webhooks", label: "Webhooks" },
  { id: "errors", label: "Errors" },
  { id: "mock-mode", label: "Mock mode" },
  { id: "use-cases", label: "Use cases" },
  { id: "privacy", label: "Privacy & data" },
];

const ERROR_DESCRIPTIONS: Record<string, string> = {
  NETWORK_ERROR: "The service could not be reached.",
  TIMEOUT: "The request exceeded the client timeout.",
  ABORTED: "The client cancelled the request.",
  SESSION_EXPIRED: "The session's time-to-live elapsed. Start a new session.",
  RATE_LIMITED: "Too many requests for this key or site.",
  UNAUTHORIZED: "Missing or invalid credentials.",
  INVALID_CREDENTIALS: "Login failed.",
  VALIDATION_ERROR: "The request body failed validation.",
  NOT_FOUND: "The session or resource does not exist.",
  INVALID_RESPONSE: "The response did not match the expected contract.",
  SERVER_ERROR: "The service failed to process the request.",
  UNKNOWN: "An unclassified error.",
};

const RETRYABLE = new Set(["NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED", "SERVER_ERROR"]);

const WEBHOOK_DESCRIPTIONS: Record<string, string> = {
  "verification.completed": "A session was verified and a token issued.",
  "verification.step_up": "The policy requested an additional challenge.",
  "verification.blocked": "A session was denied by the policy.",
  "session.expired": "A session expired before completion.",
};

export default function DocsPage() {
  return (
    <div className="relative pt-(--nav-height)">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-grid opacity-60"
      />
      <Container size="wide" className="py-14 sm:py-20">
        <header className="flex max-w-3xl flex-col gap-4 pb-12">
          <div className="flex items-center gap-2">
            <p className="eyebrow">Documentation</p>
            <Badge tone="warning" size="sm">
              Beta API draft
            </Badge>
          </div>
          <h1 className="text-h1 text-balance">Integrate {siteConfig.name}</h1>
          <p className="text-body-lg text-pretty text-muted">
            Everything you need to add verification to a flow: render the widget, redeem the token
            on your server, and act on the decision. This preview documents the beta contract used
            by the mock and HTTP adapters in this codebase.
          </p>
        </header>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
          <aside className="min-w-0">
            <DocsNav items={NAV} />
          </aside>

          <article className="flex max-w-3xl min-w-0 flex-col gap-12">
            <DocsSection id="overview" title="Overview">
              <p className="text-muted">
                A verification has three parts. The{" "}
                <strong className="text-foreground">widget</strong> runs in the browser with a
                public site key and completes a short-lived session. Your{" "}
                <strong className="text-foreground">server</strong> receives a single-use token and
                redeems it with a secret key. The{" "}
                <strong className="text-foreground">policy</strong> turns the session&apos;s signals
                into a decision: <InlineCode>allow</InlineCode>, <InlineCode>step_up</InlineCode> or{" "}
                <InlineCode>deny</InlineCode>.
              </p>
            </DocsSection>

            <DocsSection id="quickstart" title="Quickstart">
              <ol className="flex flex-col gap-8">
                <li className="flex flex-col gap-3">
                  <p className="font-medium">1. Configure keys</p>
                  <p className="text-sm text-muted">
                    Create a test key in the dashboard. The site key is public; the secret key must
                    stay on your server.
                  </p>
                  <DocsCode sample={envSample} />
                </li>
                <li className="flex flex-col gap-3">
                  <p className="font-medium">2. Render the widget</p>
                  <p className="text-sm text-muted">
                    The widget calls you back with a token once the session is verified.
                  </p>
                  <DocsCode sample={widgetSample} />
                </li>
                <li className="flex flex-col gap-3">
                  <p className="font-medium">3. Redeem the token on your server</p>
                  <DocsCode sample={serverSample} />
                  <DocsCode sample={pythonSample} />
                </li>
              </ol>
            </DocsSection>

            <DocsSection id="verification-flow" title="Verification flow">
              <ol className="flex flex-col gap-3 text-sm text-muted">
                {[
                  ["Session", "The widget creates a session with a short time-to-live."],
                  [
                    "Challenge",
                    "A lightweight challenge is issued — press-and-hold, or a single step for assistive input.",
                  ],
                  [
                    "Signals",
                    "Interaction, challenge, session and request signals resolve independently.",
                  ],
                  [
                    "Decision",
                    "The policy aggregates the signals and returns allow, step_up or deny.",
                  ],
                  ["Token", "On allow, a single-use token is issued to the widget."],
                  ["Redemption", "Your server redeems the token once and enforces the outcome."],
                ].map(([title, body], index) => (
                  <li
                    key={title}
                    className="flex gap-4 rounded-xl border border-border bg-surface p-4"
                  >
                    <span className="font-mono text-xs text-subtle tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{title}.</span> {body}
                    </span>
                  </li>
                ))}
              </ol>
            </DocsSection>

            <DocsSection id="api-reference" title="API reference">
              <p className="text-sm text-muted">
                JSON over HTTPS. Field names are camelCase. Errors use the envelope{" "}
                <InlineCode>{`{ "error": { "code", "message", "requestId" } }`}</InlineCode>.
              </p>
              <Endpoint method="POST" path="/v1/sessions" auth="Public site key · browser">
                <p>Creates a verification session and returns the challenge to present.</p>
                <p>
                  Returns <InlineCode>id</InlineCode>, <InlineCode>status</InlineCode>,{" "}
                  <InlineCode>challenge.type</InlineCode>,{" "}
                  <InlineCode>challenge.ttlSeconds</InlineCode>, <InlineCode>expiresAt</InlineCode>.
                </p>
              </Endpoint>
              <Endpoint
                method="POST"
                path="/v1/sessions/{id}/challenge"
                auth="Public site key · browser"
              >
                <p>
                  Submits the challenge response (<InlineCode>type</InlineCode>,{" "}
                  <InlineCode>inputMethod</InlineCode>, <InlineCode>holdDurationMs</InlineCode>) and
                  returns the decision with its signals. A token is present only when{" "}
                  <InlineCode>decision</InlineCode> is <InlineCode>allow</InlineCode>.
                </p>
              </Endpoint>
              <Endpoint method="POST" path="/v1/verify" auth="Secret key · server only">
                <p>
                  Redeems a token once. A second redemption returns <InlineCode>410</InlineCode>.
                </p>
              </Endpoint>
              <DocsCode sample={restSample} />
              <DocsCode sample={responseSample} />
            </DocsSection>

            <DocsSection id="signals" title="Signals">
              <p className="text-sm text-muted">
                Each signal is scored from 0 to 1 and classified as <InlineCode>pass</InlineCode> (≥{" "}
                {SIGNAL_PASS_AT.toFixed(2)}), <InlineCode>review</InlineCode> (≥{" "}
                {SIGNAL_REVIEW_AT.toFixed(2)}) or <InlineCode>fail</InlineCode>.
              </p>
              <DocsTable
                caption="Signal catalog"
                headers={["Signal", "Default weight", "What it measures"]}
                rows={SIGNALS.map((signal) => [
                  <code key="k" className="font-mono text-xs">
                    {signal.id}
                  </code>,
                  signal.weight.toFixed(2),
                  signal.summary,
                ])}
              />
            </DocsSection>

            <DocsSection id="policies" title="Policies">
              <p className="text-sm text-muted">
                The aggregate is the weighted mean of resolved signals. With the default policy,
                scores at or above <InlineCode>{DEFAULT_POLICY.allowAt.toFixed(2)}</InlineCode> are
                allowed, scores at or above{" "}
                <InlineCode>{DEFAULT_POLICY.stepUpAt.toFixed(2)}</InlineCode> get a step-up
                challenge, and lower scores are denied. A single failing signal can downgrade an
                allow to a step-up, but never denies on its own.
              </p>
            </DocsSection>

            <DocsSection id="webhooks" title="Webhooks">
              <p className="text-sm text-muted">
                Endpoints must use HTTPS. Events are delivered as JSON with the event type and the
                session&apos;s decision.
              </p>
              <DocsTable
                caption="Webhook events"
                headers={["Event", "Sent when"]}
                rows={webhookEventTypeSchema.options.map((type) => [
                  <code key="e" className="font-mono text-xs">
                    {type}
                  </code>,
                  WEBHOOK_DESCRIPTIONS[type] ?? "",
                ])}
              />
            </DocsSection>

            <DocsSection id="errors" title="Errors">
              <DocsTable
                caption="Error codes"
                headers={["Code", "Retryable", "Meaning"]}
                rows={apiErrorCodeSchema.options.map((code) => [
                  <code key="c" className="font-mono text-xs">
                    {code}
                  </code>,
                  RETRYABLE.has(code) ? "Yes" : "No",
                  ERROR_DESCRIPTIONS[code] ?? "",
                ])}
              />
            </DocsSection>

            <DocsSection id="mock-mode" title="Mock mode">
              <p className="text-sm text-muted">
                With <InlineCode>NEXT_PUBLIC_VERIFICATION_MODE=mock</InlineCode> (the default),
                every request is served by a deterministic in-browser adapter. It exists for UI
                development and demos, and{" "}
                <strong className="text-foreground">provides no protection</strong>. Set the mode to{" "}
                <InlineCode>live</InlineCode> and <InlineCode>NEXT_PUBLIC_API_BASE_URL</InlineCode>{" "}
                to use the HTTP adapter against a real backend.
              </p>
              <DocsTable
                caption="Mock scenarios"
                headers={["Scenario", "Behavior"]}
                rows={[
                  ["success", "All four signals pass; decision allow with a demo token."],
                  ["step_up", "Two signals need review; decision step_up. Retrying succeeds."],
                  ["timeout", "The session expires while signals resolve. Starting over succeeds."],
                  ["network_error", "The challenge request fails once. Retrying succeeds."],
                ]}
              />
              <p className="text-sm text-muted">
                Mock sessions expire after {MOCK_SESSION_TTL_SECONDS} seconds. The mock login
                accepts any email and password, except the password{" "}
                <InlineCode>{MOCK_INVALID_PASSWORD}</InlineCode>, which returns an
                invalid-credentials error so error states can be tested.
              </p>
            </DocsSection>

            <DocsSection id="use-cases" title="Use cases">
              <div className="grid gap-4 sm:grid-cols-2">
                {useCases.map(({ slug, icon: Icon, title, body }) => (
                  <div
                    key={slug}
                    id={`use-case-${slug}`}
                    data-anchor
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
                  >
                    <Icon aria-hidden className="size-[18px] text-accent" />
                    <h3 className="font-medium">{title}</h3>
                    <p className="text-sm text-muted">{body}</p>
                  </div>
                ))}
              </div>
            </DocsSection>

            <DocsSection id="privacy" title="Privacy & data">
              <p className="text-sm text-muted">{security.body}</p>
              <dl className="flex flex-col gap-4">
                {security.details.map((detail) => (
                  <div key={detail.id} className="rounded-xl border border-border bg-surface p-5">
                    <dt className="font-medium">{detail.title}</dt>
                    <dd className="mt-1.5 text-sm text-muted">{detail.body}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-subtle">{security.complianceNote}</p>
            </DocsSection>
          </article>
        </div>
      </Container>
    </div>
  );
}
