"use client";

import React, { useState } from "react";
import { XCircle, CheckCircle2, ArrowRight } from "lucide-react";

export const Comparison: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"all" | "memory" | "safety" | "transfer">("all");

  const comparisonData = [
    {
      category: "memory",
      topic: "Failure Handling",
      before: "Repeats the identical mistake on every run. No concept of why an action failed.",
      after: "Diagnoses root cause (13 taxonomies), synthesizes counterfactual alternatives, remembers fix forever.",
    },
    {
      category: "memory",
      topic: "Context & Token Usage",
      before: "Dumps raw transcripts into LLM context prompts, rapidly exceeding token budgets and degrading attention.",
      after: "Compact procedural SQLite memory stores only actionable, versioned strategy rules.",
    },
    {
      category: "safety",
      topic: "Improvement Validation",
      before: "Self-evaluating agent hallucinates that it succeeded even when stuck in loops.",
      after: "Independent verifier + two-proportion z-test promotion gate. Agent never verifies itself.",
    },
    {
      category: "transfer",
      topic: "Cross-Domain Generalization",
      before: "What the agent learns on Website A cannot be used on Website B.",
      after: "Learned strategies transfer zero-shot to brand-new, unseen environments with 100% transfer success.",
    },
    {
      category: "safety",
      topic: "Safety & Rollback",
      before: "Prompt modifications can silently break previously working abilities with no audit trail.",
      after: "Full version DAG (Git-like history) with 1-click atomic rollback if a regression occurs.",
    },
  ];

  const filtered = activeTab === "all" ? comparisonData : comparisonData.filter(d => d.category === activeTab);

  return (
    <section id="comparison" className="py-24 px-6 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <div className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 mb-2">
          Empirical Difference
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Standard Browser Agents vs. <span className="text-gradient">ACBE</span>
        </h2>
        <p className="mt-3 text-sm text-gray-400">
          See why standard prompt engineering hits a ceiling, and how continuous self-improvement breaks through.
        </p>

        {/* Filter chips */}
        <div className="flex justify-center gap-2 mt-6">
          {(["all", "memory", "safety", "transfer"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium capitalize transition-all ${
                activeTab === tab
                  ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                  : "bg-surface-subtle text-gray-400 hover:text-white border border-surface-border"
              }`}
            >
              {tab === "all" ? "All Features" : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Side by side cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Without ACBE Column */}
        <div className="glass-panel rounded-2xl p-6 border-rose-500/20 bg-gradient-to-b from-[#140b0d] to-surface relative">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-rose-500/20">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
              <XCircle className="w-5 h-5" /> Traditional Browser Agents
            </div>
            <span className="text-xs font-mono text-rose-400/80 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
              0% Learning
            </span>
          </div>

          <div className="space-y-4">
            {filtered.map((item, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-black/40 border border-white/[0.04]">
                <div className="text-xs font-mono text-gray-400 font-bold mb-1">{item.topic}</div>
                <div className="text-xs text-rose-200/80 leading-relaxed">{item.before}</div>
              </div>
            ))}
          </div>
        </div>

        {/* With ACBE Column */}
        <div className="glass-panel rounded-2xl p-6 border-emerald-500/20 bg-gradient-to-b from-[#0b1411] to-surface relative">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
              <CheckCircle2 className="w-5 h-5" /> ACBE Self-Improving Agents
            </div>
            <span className="text-xs font-mono text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 font-bold">
              100% Recovery
            </span>
          </div>

          <div className="space-y-4">
            {filtered.map((item, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-black/40 border border-emerald-500/20">
                <div className="text-xs font-mono text-emerald-400 font-bold mb-1">{item.topic}</div>
                <div className="text-xs text-emerald-100/90 leading-relaxed font-medium">{item.after}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
