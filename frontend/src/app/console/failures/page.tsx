"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  Search,
  Filter,
  Zap,
  RotateCcw,
  CheckCircle2,
  Clock,
  Fingerprint,
  Layers,
  ArrowUpRight,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { FailureRecord, ImproveResult } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { getFriendlyTaskName, getFriendlyTaxonomyName, formatFriendlyDate } from "@/lib/utils";

export default function FailuresPage() {
  const { addToast } = useToast();
  const [failures, setFailures] = useState<FailureRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [improvingTaskId, setImprovingTaskId] = useState<string | null>(null);
  const [activeImprovement, setActiveImprovement] = useState<ImproveResult | null>(null);

  const fetchFailures = async () => {
    setLoading(true);
    try {
      const data = await api.getFailures();
      setFailures(data);
    } catch (err: any) {
      addToast("Failed to load failure registry: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFailures();
  }, []);

  const handleImprove = async (taskId: string) => {
    setImprovingTaskId(taskId);
    setActiveImprovement(null);
    try {
      const res = await api.improveTask(taskId);
      setActiveImprovement(res);
      if (res.improvement?.promoted) {
        addToast(`Repaired scenario successfully! Winning strategy promoted.`, "success");
        fetchFailures();
      } else {
        addToast(`Autonomous improvement completed trial validation.`, "info");
      }
    } catch (err: any) {
      addToast("Remediation failed: " + err.message, "error");
    } finally {
      setImprovingTaskId(null);
    }
  };

  const failureTypes = [
    "ALL",
    ...Array.from(new Set(failures.map((f) => f.failure_type))),
  ];

  const filtered = failures.filter((f) => {
    const matchesType = selectedType === "ALL" || f.failure_type === selectedType;
    const matchesSearch =
      searchQuery === "" ||
      f.task_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.error.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.failure_type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="Diagnostic Failure Taxonomy & Autopsy Lab"
        description="Inspect trapped browser episodes, review root cause invariants, and launch automated repairs."
        onRefresh={fetchFailures}
      />

      <div className="p-8 space-y-6">
        {/* KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="text-xs font-mono text-gray-400 uppercase tracking-wider">Total Diagnostic Events</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">{failures.length}</div>
            <div className="text-xs text-gray-400 mt-1">Classified by Counterfactual Invariants</div>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="text-xs font-mono text-gray-400 uppercase tracking-wider">Unique Trap Categories</div>
            <div className="text-2xl font-bold font-mono text-amber-400 mt-1">
              {new Set(failures.map((f) => f.failure_type)).size}
            </div>
            <div className="text-xs text-gray-400 mt-1">Covering dynamic modern web hazards</div>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="text-xs font-mono text-gray-400 uppercase tracking-wider">Avg Diagnostic Confidence</div>
            <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
              {failures.length > 0
                ? `${Math.round((failures.reduce((acc, f) => acc + f.confidence, 0) / failures.length) * 100)}%`
                : "100%"}
            </div>
            <div className="text-xs text-gray-400 mt-1">Bayesian inference probability</div>
          </div>
        </div>

        {/* Auto-Improve Outcome Banner */}
        {activeImprovement && activeImprovement.improvement && (
          <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-surface to-surface border border-emerald-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Remediation Complete: {getFriendlyTaskName(activeImprovement.task_id)}
                </h4>
                {activeImprovement.improvement.promoted ? (
                  <Pill variant="promoted">Promoted</Pill>
                ) : (
                  <Pill variant="experimental">Validated</Pill>
                )}
              </div>
              <p className="text-xs text-gray-300">
                Root Cause: {activeImprovement.improvement.root_cause}
              </p>
            </div>
            <div className="text-xs font-mono bg-[#0a0d12] px-3.5 py-2 rounded-xl border border-white/10 text-emerald-300">
              Resolved Selector: {activeImprovement.improvement.top_candidate || "N/A"}
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div className="p-5 rounded-2xl bg-surface border border-surface-border flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by scenario name, failure type, or symptoms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-xs focus:outline-none focus:border-amber-500 font-sans transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto py-1">
            <Filter className="w-3.5 h-3.5 text-gray-500 shrink-0 mr-1" />
            {failureTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all ${
                  selectedType === type
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                    : "bg-[#0a0d12] text-gray-400 border border-white/5 hover:text-white"
                }`}
              >
                {type === "ALL" ? "All Categories" : type.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Failure Cards List */}
        <div className="rounded-2xl bg-surface border border-surface-border overflow-hidden">
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <RotateCcw className="w-6 h-6 text-amber-400 animate-spin mx-auto" />
              <p className="text-xs text-gray-400">Loading diagnostic telemetry...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-gray-600 mx-auto" />
              <p className="text-sm font-semibold text-white">No failures match your filter</p>
              <p className="text-xs text-gray-400">
                All navigation runs under this category are operating smoothly.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {filtered.map((item, idx) => (
                <div
                  key={item.fingerprint_id || idx}
                  className="p-5 hover:bg-surface-subtle/50 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-bold text-white">
                        {getFriendlyTaskName(item.task_id)}
                      </span>
                      <Pill variant="warning">
                        {getFriendlyTaxonomyName(item.failure_type)}
                      </Pill>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {Math.round(item.confidence * 100)}% Confidence
                      </span>
                    </div>

                    <p className="text-xs text-gray-300 bg-[#0a0d12] p-3 rounded-xl border border-white/5 font-sans leading-relaxed">
                      {item.error}
                    </p>

                    <div className="text-[11px] font-mono text-gray-400 flex items-center gap-3">
                      <span>Scenario ID: {item.task_id}</span>
                      {item.timestamp && (
                        <span>Logged: {formatFriendlyDate(item.timestamp)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleImprove(item.task_id)}
                      disabled={improvingTaskId === item.task_id}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-sm shadow-amber-500/10"
                    >
                      {improvingTaskId === item.task_id ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          Synthesizing...
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          Auto-Repair
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
