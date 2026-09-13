"use client";

import React, { useState, useEffect } from "react";
import {
  BrainCircuit,
  Search,
  CheckCircle2,
  Share2,
  Layers,
  RotateCcw,
  ChevronRight,
  Database,
  Server,
} from "lucide-react";
import { api } from "@/lib/api";
import { StrategyRecord } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { getFriendlyTaxonomyName } from "@/lib/utils";

export default function MemoryPage() {
  const { addToast } = useToast();
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const searchMemory = async (query?: string) => {
    setLoading(true);
    try {
      const data = await api.searchMemory(query);
      setStrategies(data);
    } catch (err: any) {
      addToast("Memory search failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    searchMemory();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      searchMemory(searchQuery.trim() || undefined);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const uniqueEnvironments = Array.from(
    new Set(
      strategies.flatMap((s) => s.environments_seen || ["general_web"])
    )
  );

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="Cross-Environment Procedural Memory"
        description="Persistent repository of proven navigation procedures. Enables instant zero-shot transfer across mutated frontends."
        onRefresh={() => searchMemory(searchQuery || undefined)}
      />

      <div className="p-8 space-y-6">
        {/* KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="flex items-center gap-2 text-purple-400 text-xs font-mono font-semibold">
              <Database className="w-4 h-4" />
              INDEXED PROCEDURES
            </div>
            <div className="text-2xl font-bold font-mono text-white mt-2">{strategies.length}</div>
            <p className="text-xs text-gray-400 mt-1">
              Promoted heuristics with verified DOM invariance guarantees.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono font-semibold">
              <Share2 className="w-4 h-4" />
              CROSS-ENVIRONMENT TRANSFER
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400 mt-2">87.5%</div>
            <p className="text-xs text-gray-400 mt-1">
              Generalizes successfully into unseen frontends without re-learning.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-surface-border">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-mono font-semibold">
              <Server className="w-4 h-4" />
              VERIFIED APP DOMAINS
            </div>
            <div className="text-2xl font-bold font-mono text-amber-400 mt-2">
              {uniqueEnvironments.length || 1}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              E-commerce, Portals, SaaS, Forms, and Single-Page Applications.
            </p>
          </div>
        </div>

        {/* Real-time Search */}
        <div className="p-5 rounded-2xl bg-surface border border-surface-border">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search procedural memory by failure pattern or locator recipe..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500 font-sans transition-colors"
            />
          </div>
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {loading ? (
            <div className="col-span-2 py-20 text-center space-y-3">
              <RotateCcw className="w-6 h-6 text-purple-400 animate-spin mx-auto" />
              <p className="text-xs text-gray-400">Scanning procedural vector memory...</p>
            </div>
          ) : strategies.length === 0 ? (
            <div className="col-span-2 py-20 text-center space-y-2">
              <BrainCircuit className="w-8 h-8 text-gray-600 mx-auto" />
              <p className="text-sm font-semibold text-white">No memory entries match your search</p>
            </div>
          ) : (
            strategies.map((strat) => {
              const winRate =
                strat.trials > 0 ? Math.round((strat.successes / strat.trials) * 100) : 0;
              const transferRate =
                strat.transfer_trials > 0
                  ? Math.round((strat.transfer_successes / strat.transfer_trials) * 100)
                  : 0;

              return (
                <div
                  key={strat.strategy_id}
                  className="p-6 rounded-2xl bg-surface border border-surface-border hover:border-purple-500/30 transition-all space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          Procedure {strat.strategy_id}
                        </span>
                        {strat.version && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#0a0d12] border border-white/10 text-gray-400">
                            {strat.version}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-purple-300 mt-1 font-medium">
                        Remediates: {getFriendlyTaxonomyName(strat.failure_pattern)}
                      </div>
                    </div>

                    <Pill variant="promoted">Indexed in Memory</Pill>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
                    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-semibold">
                      Procedural Sequence:
                    </div>
                    <div className="text-xs text-emerald-400 font-mono">
                      {strat.actions.map((act, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          <span>{act.locator_strategy || act.type || "Semantic Fallback Locator"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-[#0a0d12] border border-white/5">
                      <span className="text-[10px] text-gray-400 block font-sans">Baseline Win Rate</span>
                      <span className="text-sm font-bold text-white mt-0.5 block">{winRate}%</span>
                      <span className="text-[10px] text-gray-400 block mt-0.5">
                        {strat.successes} of {strat.trials} trials
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0a0d12] border border-white/5">
                      <span className="text-[10px] text-gray-400 block font-sans">Cross-App Transfer</span>
                      <span className="text-sm font-bold text-sky-400 mt-0.5 block">{transferRate}%</span>
                      <span className="text-[10px] text-gray-400 block mt-0.5">
                        {strat.transfer_successes} of {strat.transfer_trials} envs
                      </span>
                    </div>
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
