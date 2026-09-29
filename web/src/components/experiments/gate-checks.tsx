"use client";

import type { ReactNode } from "react";
import { pct, num } from "@/components/evaluations/lab-status";
import { CheckMark } from "@/components/evaluations/lab";
import { usd } from "@/lib/format";

type Check = Record<string, unknown>;

const CHECK_LABEL: Record<string, string> = {
  unauthorized_actions: "Unauthorized actions",
  false_completions: "False completions",
  regression: "Regressions",
  cost: "Cost per task",
};

const CHECK_HINT: Record<string, string> = {
  unauthorized_actions: "Must be zero for the candidate",
  false_completions: "Must not increase",
  regression: "Baseline-passing cases that now fail",
  cost: "May rise by at most the policy's allowance",
};

function cell(key: string, check: Check, side: "baseline" | "candidate"): ReactNode {
  const v = num(check[side]);
  if (v === null) return "—";
  if (key === "cost") return usd(v);
  return pct(v, 1);
}

/**
 * Promotion-gate safety checks as returned by the backend (`safety_checks.checks` / the ACBE
 * experiment `safety_checks`). Renders the known checks as a readable table; others generically.
 */
export function GateChecksTable({ checks }: { checks: Record<string, unknown> }) {
  const entries = Object.entries(checks).filter(
    ([, v]) => v && typeof v === "object" && "ok" in (v as object),
  ) as Array<[string, Check]>;
  if (entries.length === 0) return <p className="text-xs text-fg-subtle">No safety checks were recorded.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-xs">
        <caption className="sr-only">Safety gate checks</caption>
        <thead>
          <tr className="border-b border-line text-2xs tracking-wider text-fg-subtle uppercase">
            <th scope="col" className="py-2 pr-3 font-medium">
              Check
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Baseline
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Candidate
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Gate
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, check]) => (
            <tr key={key} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal">
                <div className="text-fg">{CHECK_LABEL[key] ?? key.replace(/_/g, " ")}</div>
                <div className="text-2xs text-fg-subtle">{CHECK_HINT[key] ?? ""}</div>
              </th>
              {key === "regression" ? (
                <td colSpan={2} className="px-3 py-2 font-mono text-fg-muted">
                  {String(check.regressed ?? 0)} of {String(check.baseline_passing ?? 0)} regressed (
                  {pct(check.rate, 1)})
                  {Array.isArray(check.regressed_cases) && check.regressed_cases.length > 0 && (
                    <div className="mt-0.5 text-2xs text-danger">{(check.regressed_cases as string[]).join(", ")}</div>
                  )}
                </td>
              ) : (
                <>
                  <td className="px-3 py-2 font-mono text-fg-muted tabular-nums">{cell(key, check, "baseline")}</td>
                  <td className="px-3 py-2 font-mono text-fg tabular-nums">{cell(key, check, "candidate")}</td>
                </>
              )}
              <td className="py-2 pl-3 text-right">
                <CheckMark ok={Boolean(check.ok)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const METRIC_ROWS: Array<{
  key: string;
  label: string;
  format: (v: unknown) => string;
  better: "higher" | "lower" | null;
}> = [
  { key: "task_success_rate", label: "Success", format: (v) => pct(v, 1), better: "higher" },
  { key: "unauthorized_action_rate", label: "Unauthorized", format: (v) => pct(v, 1), better: "lower" },
  { key: "false_completion_rate", label: "False completion", format: (v) => pct(v, 1), better: "lower" },
  { key: "verification_pass_rate", label: "Verification", format: (v) => pct(v, 1), better: "higher" },
  { key: "recovery_success_rate", label: "Recovery", format: (v) => pct(v, 1), better: "higher" },
  { key: "tool_call_accuracy", label: "Tool accuracy", format: (v) => pct(v, 1), better: "higher" },
  {
    key: "latency_ms_mean",
    label: "Latency (mean)",
    format: (v) => (num(v) !== null ? `${Math.round(num(v)!)} ms` : "—"),
    better: "lower",
  },
  {
    key: "cost_per_task",
    label: "Cost per task",
    format: (v) => (num(v) !== null ? usd(num(v)) : "—"),
    better: "lower",
  },
  { key: "cases", label: "Trials", format: (v) => (num(v) !== null ? String(num(v)) : "—"), better: null },
];

/** Side-by-side metrics for several variants (columns), highlighting the best value per row. */
export function MetricsComparison({
  columns,
  highlight,
}: {
  columns: Array<{ name: string; metrics: Record<string, unknown>; tag?: ReactNode }>;
  highlight?: string | null;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-xs">
        <caption className="sr-only">Metrics by variant</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              Metric
            </th>
            {columns.map((c) => (
              <th key={c.name} scope="col" className="px-3 py-2 font-mono text-xs font-medium text-fg">
                <span className="flex items-center gap-1.5">
                  {c.name}
                  {c.tag}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const values = columns.map((c) => num(c.metrics[row.key]));
            const present = values.filter((v): v is number => v !== null);
            const best =
              row.better && present.length > 1
                ? row.better === "higher"
                  ? Math.max(...present)
                  : Math.min(...present)
                : null;
            const allEqual = present.length > 1 && present.every((v) => v === present[0]);
            return (
              <tr key={row.key} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 font-normal text-fg-muted">
                  {row.label}
                </th>
                {columns.map((c, i) => {
                  const v = values[i];
                  const isBest = best !== null && !allEqual && v === best;
                  return (
                    <td
                      key={c.name}
                      className={`px-3 py-2 font-mono tabular-nums ${isBest ? "text-success" : c.name === highlight ? "text-fg" : "text-fg-muted"}`}
                    >
                      {row.format(c.metrics[row.key])}
                      {isBest && <span className="sr-only"> (best)</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
