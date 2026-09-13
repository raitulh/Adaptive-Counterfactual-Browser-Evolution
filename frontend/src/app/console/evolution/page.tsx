"use client";

import React, { useState, useEffect } from "react";
import {
  GitBranch,
  RotateCcw,
  Cpu,
  Layers,
  GitCommit,
  History,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { EvolutionTreeData } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { formatFriendlyDate } from "@/lib/utils";

export default function EvolutionPage() {
  const { addToast } = useToast();
  const [data, setData] = useState<EvolutionTreeData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [rollbackModal, setRollbackModal] = useState<{
    open: boolean;
    kind: "agent" | "strategy";
    version: string;
  }>({
    open: false,
    kind: "agent",
    version: "",
  });
  const [rollbackReason, setRollbackReason] = useState<string>("");
  const [isSubmittingRollback, setIsSubmittingRollback] = useState<boolean>(false);

  const fetchTree = async () => {
    setLoading(true);
    try {
      const tree = await api.getEvolutionTree();
      setData(tree);
    } catch (err: any) {
      addToast("Failed to load version tree: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, []);

  const handleOpenRollback = (kind: "agent" | "strategy", version: string) => {
    setRollbackModal({ open: true, kind, version });
    setRollbackReason("Rollback to stable release snapshot via ACBE Console.");
  };

  const handleConfirmRollback = async () => {
    if (!rollbackModal.version) return;
    setIsSubmittingRollback(true);
    try {
      const res = await api.rollback(
        rollbackModal.kind,
        rollbackModal.version,
        rollbackReason
      );
      if (res.success) {
        addToast(
          `Successfully rolled back ${rollbackModal.kind} to ${res.active_version}!`,
          "success"
        );
        setRollbackModal({ open: false, kind: "agent", version: "" });
        fetchTree();
      }
    } catch (err: any) {
      addToast("Rollback failed: " + err.message, "error");
    } finally {
      setIsSubmittingRollback(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="Evolution DAG & Safe Rollback Hub"
        description="Track autonomous agent and strategy versions. Revert any detected regression with atomic 1-click snapshot rollback."
        onRefresh={fetchTree}
      />

      <div className="p-8 space-y-6">
        {/* Active Version Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="p-6 rounded-2xl bg-surface border border-amber-500/30 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-amber-400 font-bold tracking-wider flex items-center gap-1.5">
                <Cpu className="w-4 h-4" /> Active Agent Orchestrator
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                ONLINE
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-white mt-2">
              {data?.active_agent || "agent-v1"}
            </div>
            <p className="text-xs text-gray-300 mt-1">
              Active orchestrator model executing counterfactual navigation workflows.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-surface border border-emerald-500/30 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-emerald-400 font-bold tracking-wider flex items-center gap-1.5">
                <Layers className="w-4 h-4" /> Active Strategy Set
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                DEPLOYED
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-white mt-2">
              {data?.active_strategy || "strat-v1"}
            </div>
            <p className="text-xs text-gray-300 mt-1">
              Curated procedural heuristics bundle currently used for runtime fallback.
            </p>
          </div>
        </div>

        {/* Tree Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Versions */}
          <div className="p-6 rounded-2xl bg-surface border border-surface-border space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div className="flex items-center gap-2">
                <GitCommit className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Agent Evolutionary Lineage</h3>
              </div>
              <span className="text-xs font-mono text-gray-400">
                {data?.agent_versions.length || 0} Snapshots
              </span>
            </div>

            <div className="space-y-3 relative before:absolute before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-white/10">
              {data?.agent_versions.map((ver) => {
                const isActive = ver.version === data.active_agent;
                return (
                  <div key={ver.version} className="relative pl-8 group">
                    <span
                      className={`absolute left-2 top-3.5 w-3 h-3 rounded-full border-2 ${
                        isActive
                          ? "bg-amber-400 border-amber-500"
                          : "bg-[#0a0d12] border-gray-600"
                      }`}
                    ></span>

                    <div
                      className={`p-4 rounded-xl border transition-all ${
                        isActive
                          ? "bg-surface-subtle border-amber-500/30"
                          : "bg-[#0a0d12] border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">{ver.version}</span>
                          {isActive && <Pill variant="promoted">Active Head</Pill>}
                        </div>

                        {!isActive && (
                          <button
                            onClick={() => handleOpenRollback("agent", ver.version)}
                            className="px-2.5 py-1 rounded-lg bg-surface-subtle hover:bg-rose-500/20 text-gray-300 hover:text-rose-300 border border-surface-border hover:border-rose-500/30 text-xs font-mono transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Rollback
                          </button>
                        )}
                      </div>

                      <div className="text-[11px] text-gray-400 mt-2 flex items-center justify-between">
                        <span>Parent: {ver.parent_version || "ROOT"}</span>
                        <span>{formatFriendlyDate(ver.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Strategy Versions */}
          <div className="p-6 rounded-2xl bg-surface border border-surface-border space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Strategy Registry Lineage</h3>
              </div>
              <span className="text-xs font-mono text-gray-400">
                {data?.strategy_versions.length || 0} Snapshots
              </span>
            </div>

            <div className="space-y-3 relative before:absolute before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-white/10">
              {data?.strategy_versions.map((ver) => {
                const isActive = ver.version === data.active_strategy;
                return (
                  <div key={ver.version} className="relative pl-8 group">
                    <span
                      className={`absolute left-2 top-3.5 w-3 h-3 rounded-full border-2 ${
                        isActive
                          ? "bg-emerald-400 border-emerald-500"
                          : "bg-[#0a0d12] border-gray-600"
                      }`}
                    ></span>

                    <div
                      className={`p-4 rounded-xl border transition-all ${
                        isActive
                          ? "bg-surface-subtle border-emerald-500/30"
                          : "bg-[#0a0d12] border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">{ver.version}</span>
                          {isActive && <Pill variant="promoted">Active Head</Pill>}
                        </div>

                        {!isActive && (
                          <button
                            onClick={() => handleOpenRollback("strategy", ver.version)}
                            className="px-2.5 py-1 rounded-lg bg-surface-subtle hover:bg-rose-500/20 text-gray-300 hover:text-rose-300 border border-surface-border hover:border-rose-500/30 text-xs font-mono transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Rollback
                          </button>
                        )}
                      </div>

                      <div className="text-[11px] text-gray-400 mt-2 flex items-center justify-between">
                        <span>Parent: {ver.parent_version || "ROOT"}</span>
                        <span>{formatFriendlyDate(ver.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rollback Confirmation Modal */}
        {rollbackModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="w-full max-w-md rounded-2xl bg-surface border border-surface-border p-6 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Confirm Snapshot Rollback</h3>
                  <p className="text-xs text-gray-400">
                    Revert active {rollbackModal.kind} version to snapshot &apos;{rollbackModal.version}&apos;.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-mono text-gray-400 uppercase tracking-wider">
                  Rollback Audit Reason
                </label>
                <input
                  type="text"
                  value={rollbackReason}
                  onChange={(e) => setRollbackReason(e.target.value)}
                  placeholder="State reason for rollback..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setRollbackModal({ open: false, kind: "agent", version: "" })}
                  disabled={isSubmittingRollback}
                  className="px-4 py-2 rounded-xl bg-surface-subtle text-gray-300 text-xs hover:bg-surface-border transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRollback}
                  disabled={isSubmittingRollback}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-rose-600/20"
                >
                  {isSubmittingRollback ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      Reverting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      Confirm Rollback
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
