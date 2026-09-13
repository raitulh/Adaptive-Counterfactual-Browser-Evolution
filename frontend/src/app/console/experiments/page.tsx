"use client";

import React, { useState, useEffect } from "react";
import {
  FlaskConical,
  Search,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { ExperimentRecord } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { getFriendlyTaxonomyName } from "@/lib/utils";

export default function ExperimentsPage() {
  const { addToast } = useToast();
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const fetchExperiments = async () => {
    setLoading(true);
    try {
      const data = await api.getExperiments();
      setExperiments(data);
    } catch (err: any) {
      addToast("Failed to load experiments: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExperiments();
  }, []);

  const statuses = ["ALL", "PROMOTE", "REJECT", "NEEDS_MORE_DATA"];

  const filtered = experiments.filter((exp) => {
    const matchesStatus = statusFilter === "ALL" || exp.status === statusFilter;
    const matchesSearch =
      searchQuery === "" ||
      exp.experiment_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.strategy.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (exp.decision_reason && exp.decision_reason.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="A/B Shadow Sandbox & Promotion Gates"
        description="Two-proportion hypothesis testing engine. Heuristics must clear significance, sample size, and token overhead thresholds."
        onRefresh={fetchExperiments}
      />

      <div className="p-8 space-y-6">
        {/* Promotion Gate Checklist */}
        <div className="p-6 rounded-2xl bg-surface border border-surface-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Statistical Promotion Invariants</h3>
            </div>
            <span className="text-xs text-gray-400 font-mono">Automated Gate Verification</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">1. Two-Tailed Z-Score</span>
                <span className="text-emerald-400 font-bold">z ≥ 1.96</span>
              </div>
              <p className="text-[11px] text-gray-400">95% statistical confidence that candidate outperforms baseline.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">2. Minimum Sample Size</span>
                <span className="text-emerald-400 font-bold">N ≥ 10 trials</span>
              </div>
              <p className="text-[11px] text-gray-400">Guarantees stability against transient network or page noise.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">3. Token Overhead Ceiling</span>
                <span className="text-amber-400 font-bold">Ratio ≤ 1.25x</span>
              </div>
              <p className="text-[11px] text-gray-400">Protects inference budgets from verbose exploratory prompts.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">4. Regression Safety</span>
                <span className="text-sky-400 font-bold">0% Regressions</span>
              </div>
              <p className="text-[11px] text-gray-400">Zero tolerance for breakage across existing benchmark suites.</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="p-5 rounded-2xl bg-surface border border-surface-border flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search experiments by strategy or decision..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-xs focus:outline-none focus:border-amber-500 font-sans transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto py-1">
            {statuses.map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all ${
                  statusFilter === st
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                    : "bg-[#0a0d12] text-gray-400 border border-white/5 hover:text-white"
                }`}
              >
                {st === "ALL" ? "All Experiments" : st}
              </button>
            ))}
          </div>
        </div>

        {/* Experiment Cards */}
        <div className="space-y-4">
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <RotateCcw className="w-6 h-6 text-sky-400 animate-spin mx-auto" />
              <p className="text-xs text-gray-400">Loading experimental telemetry...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center space-y-2">
              <FlaskConical className="w-8 h-8 text-gray-600 mx-auto" />
              <p className="text-sm font-semibold text-white">No experiments recorded</p>
            </div>
          ) : (
            filtered.map((exp) => {
              const baselineRate =
                exp.baseline_trials > 0
                  ? Math.round((exp.baseline_successes / exp.baseline_trials) * 100)
                  : 0;
              const candidateRate =
                exp.candidate_trials > 0
                  ? Math.round((exp.candidate_successes / exp.candidate_trials) * 100)
                  : 0;
              const delta = candidateRate - baselineRate;

              return (
                <div
                  key={exp.experiment_id}
                  className="p-6 rounded-2xl bg-surface border border-surface-border space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">Trial #{exp.experiment_id}</span>
                      <span className="text-gray-600">|</span>
                      <span className="text-xs text-gray-300">Strategy: <strong className="text-amber-400">{exp.strategy}</strong></span>
                    </div>
                    <Pill variant={exp.status === "PROMOTE" ? "promoted" : "rejected"}>
                      {exp.status}
                    </Pill>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400 font-medium">Static Baseline (A)</span>
                        <span className="text-gray-300 font-mono font-bold">{baselineRate}% Success</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full bg-gray-500 rounded-full"
                          style={{ width: `${baselineRate}%` }}
                        ></div>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono flex items-center justify-between">
                        <span>{exp.baseline_successes} wins / {exp.baseline_trials} trials</span>
                        <span>Standard Selector</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#0a0d12] border border-sky-500/20 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-sky-400 font-medium">Counterfactual Candidate (B)</span>
                        <span className="text-emerald-400 font-mono font-bold">
                          {candidateRate}% (+{delta}%)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full"
                          style={{ width: `${candidateRate}%` }}
                        ></div>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono flex items-center justify-between">
                        <span>{exp.candidate_successes} wins / {exp.candidate_trials} trials</span>
                        <span className="text-emerald-400 font-semibold">Invariant Guarded</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-surface-border text-xs">
                    <div className="text-gray-300 flex items-center gap-2">
                      <span className="text-gray-400">Evaluation Decision:</span>
                      <span className="font-medium text-white">{exp.decision_reason || "Automated threshold gate evaluation"}</span>
                    </div>

                    {exp.token_increase_ratio !== undefined && (
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>Inference Overhead:</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${
                            exp.token_increase_ratio <= 1.25
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {exp.token_increase_ratio.toFixed(2)}x
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
