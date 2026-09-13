"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { api } from "@/lib/api";
import { OverviewData } from "@/lib/types";
import { fmtNumber, getFriendlyTaxonomyName } from "@/lib/utils";
import { Zap, Database, FlaskConical, ShieldAlert, ArrowRight, Play, CheckCircle2 } from "lucide-react";

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const res = await api.getOverview();
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const failureEntries = Object.entries(data?.failures_by_type || {}).sort((a, b) => b[1] - a[1]);
  const maxFailures = failureEntries.length ? Math.max(...failureEntries.map((e) => e[1])) : 1;

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="System Pulse & Overview"
        description="Real-time telemetry, procedural memory distribution, and autonomous self-healing diagnostics."
        onRefresh={loadData}
      />

      <div className="p-8 space-y-6">
        {/* LLM Engine Integration Status */}
        <div className="p-4 rounded-xl bg-surface border border-surface-border flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-mono text-gray-400">REASONING ENGINE:</span>
            <span className="font-mono font-bold text-white bg-surface-subtle px-2.5 py-1 rounded border border-surface-border">
              {data?.llm_provider || "Google Gemini (gemini-3.8-flash)"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-[11px]">
            <span>READY & ONLINE</span>
          </div>
        </div>

        {/* KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            label="Verified Strategies"
            value={data ? data.strategies_total : "—"}
            subValue={<span className="text-emerald-400 font-bold">{data?.strategies_promoted || 0} active in memory</span>}
            icon={<Database className="w-5 h-5 text-amber-400" />}
          />
          <StatCard
            label="A/B Validation Trials"
            value={data ? data.experiments_total : "—"}
            subValue={`${data?.experiments_promoted || 0} passed gate / ${data?.experiments_rejected || 0} rejected`}
            icon={<FlaskConical className="w-5 h-5 text-sky-400" />}
          />
          <StatCard
            label="Trapped Episodes Diagnosed"
            value={data ? data.failures_total : "—"}
            subValue={`across ${Object.keys(data?.failures_by_type || {}).length} modern web failure classes`}
            icon={<ShieldAlert className="w-5 h-5 text-rose-400" />}
          />
          <StatCard
            label="Estimated Tokens Saved"
            value={data ? fmtNumber(data.estimated_tokens_saved) : "—"}
            subValue="saved via procedural reuse vs. naive prompting"
            icon={<Zap className="w-5 h-5 text-amber-400" />}
            accent
          />
        </div>

        {/* Failures by Category Breakdown */}
        <div className="glass-panel rounded-2xl p-6 border border-surface-border">
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-surface-border">
            <div>
              <h3 className="text-base font-bold text-white">Diagnostic Failure Taxonomy</h3>
              <p className="text-xs text-gray-400 mt-0.5">Adversarial web traps classified by Root Cause Diagnostic Invariants.</p>
            </div>
            <Link
              href="/console/failures"
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
            >
              Open Failure Lab <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-4">
            {!failureEntries.length && (
              <div className="text-xs text-gray-500 py-6 text-center font-mono">
                No failure events recorded. All active navigation trajectories operating with zero errors.
              </div>
            )}
            {failureEntries.map(([type, count]) => (
              <div key={type} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-200 font-medium">
                    {getFriendlyTaxonomyName(type)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-400 font-bold">{count} occurrences</span>
                    <span className="text-[10px] font-mono text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {Math.round((count / (data?.failures_total || 1)) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-surface-subtle overflow-hidden border border-white/[0.04]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500"
                    style={{ width: `${(count / maxFailures) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Callout Banner */}
        <div className="rounded-2xl p-6 bg-gradient-to-r from-amber-500/10 via-surface to-surface border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-400 font-semibold uppercase tracking-wider">
              <CheckCircle2 className="w-3.5 h-3.5" /> Autonomous Self-Improvement Ready
            </div>
            <h3 className="text-base font-bold text-white">Interactive Virtual Browser Viewport</h3>
            <p className="text-xs text-gray-300 max-w-2xl leading-relaxed">
              Dispatch autonomous browser tasks, observe real-time element interaction trajectories, and watch ACBE synthesize counterfactual heuristics to repair trapped sessions without human intervention.
            </p>
          </div>
          <Link
            href="/console/liverun"
            className="px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-xs hover:bg-accent-hover transition-all flex items-center gap-2 shrink-0 shadow-lg shadow-amber-500/10"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Open Virtual Browser
          </Link>
        </div>
      </div>
    </div>
  );
}
