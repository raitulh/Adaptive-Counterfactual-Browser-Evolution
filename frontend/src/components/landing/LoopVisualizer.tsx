"use client";

import React, { useState } from "react";
import { Eye, ShieldAlert, Cpu, FlaskConical, Database, ArrowRight } from "lucide-react";

export const LoopVisualizer: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(0);

  const steps = [
    {
      id: 0,
      title: "1. Observe & Verify",
      short: "Verify",
      icon: <Eye className="w-5 h-5" />,
      tagline: "Independent evaluator detects deceptive success or failure",
      details: "The agent is never allowed to declare its own success. The Verifier checks DOM mutation hashes and backend state changes independently.",
      code: `verifier.verify(step) 
-> state_changed: True, confidence: 0.75
-> failure_flag: WRONG_ELEMENT`,
    },
    {
      id: 1,
      title: "2. Root Cause Diagnosis",
      short: "Diagnose",
      icon: <ShieldAlert className="w-5 h-5" />,
      tagline: "Classifies failure into 13 taxonomy types",
      details: "Pinpoints the exact reason for failure (e.g. look-alike button, dynamic loading delay, or missing prerequisite fields) instead of blind retries.",
      code: `RootCauseAnalyzer.diagnose(trajectory)
-> Likely cause: Accessibility/DOM ignored.
-> Category: WRONG_ELEMENT`,
    },
    {
      id: 2,
      title: "3. Counterfactual Funnel",
      short: "Rank",
      icon: <Cpu className="w-5 h-5" />,
      tagline: "Synthesizes 10+ alternatives, filtered from cheap to expensive",
      details: "Generates alternative strategies (e.g. role_name, verify_before_click). Filters structural duplicates cheaply before calling any heavy LLMs.",
      code: `RankingFunnel.evaluate(candidates)
-> Filter: 10 -> 4 unique candidates
-> Top Winner: verify_before_click (Score: 0.85)`,
    },
    {
      id: 3,
      title: "4. Sandbox A/B Validation",
      short: "Sandbox",
      icon: <FlaskConical className="w-5 h-5" />,
      tagline: "Two-proportion z-test statistical promotion gate",
      details: "Tests the winning candidate in a sandbox against both the target task and a held-out regression suite. Enforces p-value < 0.05 and token budget limits.",
      code: `PromotionGate.decide(experiment)
-> z_score confidence: 1.000 (>= 0.95)
-> regression_failures: 0 / 4
-> VERDICT: PROMOTE`,
    },
    {
      id: 4,
      title: "5. Memory & Transfer",
      short: "Remember",
      icon: <Database className="w-5 h-5" />,
      tagline: "Stores versioned rule for zero-shot cross-website reuse",
      details: "Promoted strategy is recorded in SQLite procedural memory with an active version tag. When visiting new websites, ACBE automatically applies the learned rule.",
      code: `StrategyMemory.save(promoted_strategy)
-> Version: 1.0-strat_02
-> Cross-Task Transfer Success: 100%`,
    },
  ];

  const current = steps[activeStep];

  return (
    <section id="how-it-works" className="py-24 px-6 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <div className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 mb-2">
          Architecture & Flow
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          The 5-Stage Continuous <span className="text-gradient">Learning Loop</span>
        </h2>
        <p className="mt-3 text-sm text-gray-400">
          Click through each stage to explore how ACBE turns verified failures into permanent capabilities.
        </p>
      </div>

      {/* Steps Navigation Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-8">
        {steps.map((st) => (
          <button
            key={st.id}
            onClick={() => setActiveStep(st.id)}
            className={`p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
              activeStep === st.id
                ? "bg-surface border-amber-500 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30"
                : "bg-surface-subtle border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface"
            }`}
          >
            <div className={`${activeStep === st.id ? "text-amber-400" : "text-gray-500"}`}>
              {st.icon}
            </div>
            <div className="truncate">
              <div className="text-xs font-bold truncate">{st.short}</div>
              <div className="text-[10px] text-gray-500 font-mono">Stage {st.id + 1}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Active Stage Detailed Display */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
            {current.icon}
            <span>{current.title}</span>
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">{current.tagline}</h3>
          <p className="text-sm text-gray-300 leading-relaxed">{current.details}</p>

          <div className="pt-3 flex gap-3">
            <button
              onClick={() => setActiveStep((prev) => (prev + 1) % steps.length)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-subtle hover:bg-surface-border text-gray-200 border border-surface-border transition-all flex items-center gap-1.5"
            >
              Next Phase <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live Code / Data Payload Box */}
        <div className="bg-[#090b0e] rounded-xl p-5 border border-white/[0.06] font-mono text-xs text-gray-300 space-y-2 overflow-x-auto">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] text-[11px] text-gray-500">
            <span>STAGE_OUTPUT.json</span>
            <span className="text-emerald-400">STATUS: VERIFIED</span>
          </div>
          <pre className="text-emerald-300/90 whitespace-pre-wrap leading-relaxed">
            {current.code}
          </pre>
        </div>
      </div>
    </section>
  );
};
