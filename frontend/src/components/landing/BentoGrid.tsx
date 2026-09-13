import React from "react";
import { ShieldCheck, Cpu, Database, RefreshCw, Zap, CheckCircle2 } from "lucide-react";

export const BentoGrid: React.FC = () => {
  return (
    <section id="bento" className="py-24 px-6 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <div className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 mb-2">
          Engineering Highlights
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Built for <span className="text-gradient">Production-Grade</span> Reliability
        </h2>
        <p className="mt-3 text-sm text-gray-400">
          Six foundational architectural principles that protect against regressions and hallucinated self-improvement.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1 (Large - Spans 2 cols) */}
        <div className="md:col-span-2 glass-panel rounded-2xl p-7 border border-white/[0.08] hover:border-amber-500/30 transition-all space-y-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Statistical Promotion Gate (Two-Proportion Z-Test)</h3>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
              An agent can never declare its own victory. Every proposed strategy must beat the baseline with statistically verified significance (p &lt; 0.05), meet sample size minimums, and pass a held-out regression suite with 0 regressions.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap gap-2 text-[11px] font-mono">
            <span className="px-2.5 py-1 rounded-md bg-surface-subtle text-gray-300 border border-surface-border">Min Sample Size: 8</span>
            <span className="px-2.5 py-1 rounded-md bg-surface-subtle text-gray-300 border border-surface-border">Confidence: 95%</span>
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Regression: 0%</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="glass-panel rounded-2xl p-7 border border-white/[0.08] hover:border-amber-500/30 transition-all space-y-4">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Adaptive Model Router</h3>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
              Cheap models for known steps; frontier reasoning models only triggered when uncertainty spikes. Cuts token expenditure by up to 60%.
            </p>
          </div>
        </div>

        {/* Card 3 */}
        <div className="glass-panel rounded-2xl p-7 border border-white/[0.08] hover:border-amber-500/30 transition-all space-y-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Version DAG & 1-Click Rollback</h3>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
              Git-like version lineages for both agents and strategies. If an environment shifts and causes a regression, roll back active pointers instantly.
            </p>
          </div>
        </div>

        {/* Card 4 (Large - Spans 2 cols) */}
        <div className="md:col-span-2 glass-panel rounded-2xl p-7 border border-white/[0.08] hover:border-amber-500/30 transition-all space-y-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Cross-Task Zero-Shot Knowledge Transfer</h3>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
              A strategy learned on `shop-0` (e.g. overcoming look-alike buttons with DOM roles) is indexed into procedural memory. When navigating `shop-1`, `shop-2`, or completely new domains, ACBE transfers the rule with 100% success.
            </p>
          </div>
          <div className="pt-2 flex items-center gap-2 text-xs font-mono text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Tested across 27 synthetic tasks with 100% transfer generalization</span>
          </div>
        </div>
      </div>
    </section>
  );
};
