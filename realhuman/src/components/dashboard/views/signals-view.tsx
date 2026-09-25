import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Meter } from "@/components/ui/meter";
import { DEFAULT_POLICY, SIGNAL_PASS_AT, SIGNAL_REVIEW_AT } from "@/lib/verification/scoring";
import { SIGNALS } from "@/lib/verification/signals";

export function SignalsView() {
  return (
    <>
      <PageHeader
        title="Signals"
        description="The signals combined into every decision, and the weights your policy applies."
      />
      <MockNotice>
        Default weights shown. Tuning is available once the live API is connected.
      </MockNotice>

      <ul className="grid gap-4 md:grid-cols-2">
        {SIGNALS.map((signal, index) => (
          <li
            key={signal.id}
            className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-[15px] font-medium">{signal.label}</h2>
                <code className="font-mono text-[11px] text-subtle">{signal.key}</code>
              </div>
              <span className="font-mono text-sm tabular-nums">{signal.weight.toFixed(2)}</span>
            </div>
            <p className="text-sm text-muted">{signal.summary}</p>
            <div className="flex flex-col gap-1.5">
              <Meter value={signal.weight} delay={index * 0.06} label={`${signal.label} weight`} />
              <p className="font-mono text-[11px] text-subtle">
                weight · share of the aggregate score
              </p>
            </div>
          </li>
        ))}
      </ul>

      <section
        aria-labelledby="thresholds-title"
        className="rounded-xl border border-border bg-surface p-5"
      >
        <h2 id="thresholds-title" className="text-[15px] font-medium">
          Thresholds
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Signal pass", `≥ ${SIGNAL_PASS_AT.toFixed(2)}`],
            ["Signal review", `≥ ${SIGNAL_REVIEW_AT.toFixed(2)}`],
            ["Allow", `≥ ${DEFAULT_POLICY.allowAt.toFixed(2)}`],
            ["Step-up", `≥ ${DEFAULT_POLICY.stepUpAt.toFixed(2)}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3"
            >
              <dt className="text-xs text-subtle">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
