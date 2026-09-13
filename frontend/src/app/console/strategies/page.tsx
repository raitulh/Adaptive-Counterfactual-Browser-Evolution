"use client";

import React, { useState, useEffect } from "react";
import {
  Compass,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  RotateCcw,
  Shield,
  Layers,
  ChevronRight,
  TrendingUp,
  Award,
} from "lucide-react";
import { api } from "@/lib/api";
import { StrategyRecord } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { getFriendlyTaxonomyName } from "@/lib/utils";

export default function StrategiesPage() {
  const { addToast } = useToast();
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedLifecycle, setSelectedLifecycle] = useState<string>("ALL");

  const fetchStrategies = async () => {
    setLoading(true);
    try {
      const data = await api.getStrategies();
      setStrategies(data);
    } catch (err: any) {
      addToast("Failed to load strategy catalogue: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  const lifecycles = ["ALL", "PROMOTED", "VALIDATED", "EXPERIMENTAL", "DRAFT"];

  const countsByLifecycle = strategies.reduce((acc, s) => {
    acc[s.lifecycle] = (acc[s.lifecycle] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filtered = strategies.filter((s) => {
    const matchesLifecycle = selectedLifecycle === "ALL" || s.lifecycle === selectedLifecycle;
    const matchesSearch =
      searchQuery === "" ||
      s.strategy_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.failure_pattern.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLifecycle && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="Adaptive Strategy Registry & Quality Funnel"
        description="Curated repository of validated navigation heuristics, semantic locator fallbacks, and recovery actions."
        onRefresh={fetchStrategies}
      />

      <div className="p-8 space-y-6">
        {/* 4-Tier Funnel Card */}
        <div className="p-6 rounded-2xl bg-surface border border-surface-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">4-Tier Quality Verification Funnel</h3>
            </div>
            <span className="text-xs text-gray-400 font-mono">Statistical Promotion Pipeline</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
            <div className="p-4 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">1. Draft Candidates</span>
                <span className="text-white font-bold">{countsByLifecycle["DRAFT"] || 0}</span>
              </div>
              <p className="text-[11px] text-gray-400">Newly synthesized counterfactual heuristics.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-amber-500/20 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-amber-400">2. Experimental</span>
                <span className="text-amber-300 font-bold">{countsByLifecycle["EXPERIMENTAL"] || 0}</span>
              </div>
              <p className="text-[11px] text-gray-400">Undergoing shadow A/B trials against baselines.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-sky-500/20 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-sky-400">3. Validated</span>
                <span className="text-sky-300 font-bold">{countsByLifecycle["VALIDATED"] || 0}</span>
              </div>
              <p className="text-[11px] text-gray-400">Passed two-proportion z-test significance gate.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0a0d12] border border-emerald-500/30 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-emerald-400 font-bold">4. Promoted Active</span>
                <span className="text-emerald-300 font-bold">{countsByLifecycle["PROMOTED"] || 0}</span>
              </div>
              <p className="text-[11px] text-gray-400">Active in procedural memory for runtime fallback.</p>
            </div>
          </div>
        </div>

        {/* Filter and Search */}
        <div className="p-5 rounded-2xl bg-surface border border-surface-border flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search strategy ID or target pattern..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-xs focus:outline-none focus:border-amber-500 font-sans transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto py-1">
            <Filter className="w-3.5 h-3.5 text-gray-500 shrink-0 mr-1" />
            {lifecycles.map((lc) => (
              <button
                key={lc}
                onClick={() => setSelectedLifecycle(lc)}
                className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all ${
                  selectedLifecycle === lc
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                    : "bg-[#0a0d12] text-gray-400 border border-white/5 hover:text-white"
                }`}
              >
                {lc === "ALL" ? "All Tiers" : lc}
              </button>
            ))}
          </div>
        </div>

        {/* Strategies Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {loading ? (
            <div className="col-span-2 py-20 text-center space-y-3">
              <RotateCcw className="w-6 h-6 text-amber-400 animate-spin mx-auto" />
              <p className="text-xs text-gray-400">Loading strategy registry...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="col-span-2 py-20 text-center space-y-2">
              <Compass className="w-8 h-8 text-gray-600 mx-auto" />
              <p className="text-sm font-semibold text-white">No strategies match selected filter</p>
            </div>
          ) : (
            filtered.map((strat) => {
              const winRate =
                strat.trials > 0 ? Math.round((strat.successes / strat.trials) * 100) : 0;
              const transferWinRate =
                strat.transfer_trials > 0
                  ? Math.round((strat.transfer_successes / strat.transfer_trials) * 100)
                  : 0;

              return (
                <div
                  key={strat.strategy_id}
                  className="p-6 rounded-2xl bg-surface border border-surface-border hover:border-white/15 transition-all space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          Strategy {strat.strategy_id}
                        </span>
                        {strat.version && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#0a0d12] border border-white/10 text-gray-400">
                            {strat.version}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-amber-400/90 mt-1 font-medium">
                        Remediates: {getFriendlyTaxonomyName(strat.failure_pattern)}
                      </div>
                    </div>

                    <Pill variant="promoted">{strat.lifecycle}</Pill>
                  </div>

                  {/* Actions Description */}
                  <div className="p-3.5 rounded-xl bg-[#0a0d12] border border-white/5 space-y-1">
                    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-semibold">
                      Action Locator Recipe:
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

                  {/* Gauges */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#0a0d12] border border-white/5">
                      <div className="flex items-center justify-between text-gray-400 text-[11px] mb-1">
                        <span>Trial Win Rate</span>
                        <span className="text-white font-bold">{winRate}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full"
                          style={{ width: `${winRate}%` }}
                        ></div>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 font-mono">
                        {strat.successes} / {strat.trials} trials
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0a0d12] border border-white/5">
                      <div className="flex items-center justify-between text-gray-400 text-[11px] mb-1">
                        <span>Transfer Rate</span>
                        <span className="text-sky-400 font-bold">{transferWinRate}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full"
                          style={{ width: `${transferWinRate}%` }}
                        ></div>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 font-mono">
                        {strat.transfer_successes} / {strat.transfer_trials} environments
                      </div>
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
