"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Play, ArrowRight, CheckCircle2, AlertTriangle, ShieldCheck, Zap, RotateCcw } from "lucide-react";

export const Hero: React.FC = () => {
  const [demoStep, setDemoStep] = useState<"idle" | "failing" | "failed" | "improving" | "success">("idle");

  const runHeroDemo = () => {
    setDemoStep("failing");
    setTimeout(() => {
      setDemoStep("failed");
    }, 1400);
  };

  const runAutoImprove = () => {
    setDemoStep("improving");
    setTimeout(() => {
      setDemoStep("success");
    }, 1800);
  };

  const resetDemo = () => {
    setDemoStep("idle");
  };

  return (
    <section className="relative pt-24 pb-20 px-6 overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-amber-500/10 via-emerald-500/5 to-transparent blur-3xl pointer-events-none rounded-full" />
      <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />

      <div className="max-w-6xl mx-auto text-center relative z-10">
        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          AI Agents that <span className="text-gradient">Learn</span> from Verified Failures.
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-base sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
          Existing AI agents repeat the exact same mistakes forever. ACBE diagnoses root causes, generates counterfactual alternatives, validates them in a sandbox, and promotes permanent improvements—<strong>without retraining</strong>.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/console"
            className="w-full sm:w-auto px-8 py-4 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-xl shadow-amber-500/20 hover:shadow-amber-500/35 flex items-center justify-center gap-2.5 scale-100 hover:scale-[1.02] active:scale-[0.98]"
          >
            Launch Interactive Console <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#how-it-works"
            className="w-full sm:w-auto px-7 py-4 rounded-xl text-sm font-semibold bg-surface-subtle hover:bg-surface-border text-gray-300 hover:text-white border border-surface-border transition-all flex items-center justify-center gap-2"
          >
            Explore 5-Stage Architecture
          </a>
        </div>

        <div className="mt-16 max-w-4xl mx-auto text-left">
          <div className="glass-panel rounded-2xl p-1 shadow-2xl border border-white/10 overflow-hidden">
            {/* Window Chrome */}
            <div className="bg-[#10131a] px-4 py-3 rounded-t-xl flex items-center justify-between border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                <div className="ml-3 px-3 py-1 rounded bg-[#090b0e] text-[11px] font-mono text-gray-400 border border-white/[0.05] flex items-center gap-2">
                  <span className="text-gray-500">https://</span>
                  <span>store.sandbox.local/checkout</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                <span>Sandbox Trap Simulation</span>
              </div>
            </div>

            {/* Simulated Viewport Body */}
            <div className="p-6 bg-[#090b0e] grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[340px] items-center">
              {/* Virtual Website View */}
              <div className="bg-surface rounded-xl p-5 border border-surface-border relative overflow-hidden flex flex-col justify-between h-full">
                <div>
                  <div className="text-xs font-mono text-gray-500 mb-1">TASK: "Add to cart and proceed"</div>
                  <h4 className="text-base font-bold text-white">Smart Wireless Headphones</h4>
                  <p className="text-xs text-gray-400 mt-1">$149.00 • In Stock</p>
                </div>

                <div className="my-6 space-y-2.5">
                  <div
                    className={`p-3 rounded-lg border transition-all text-xs font-medium flex items-center justify-between ${
                      demoStep === "improving" || demoStep === "success"
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/40 scale-[1.02]"
                        : "bg-surface-subtle border-surface-border text-gray-300"
                    }`}
                  >
                    <span>Add to Cart (Main Product)</span>
                    <span className="text-[10px] font-mono text-gray-500">role="button"</span>
                  </div>

                  <div
                    className={`p-3 rounded-lg border transition-all text-xs font-medium flex items-center justify-between ${
                      demoStep === "failing" || demoStep === "failed"
                        ? "bg-rose-500/10 border-rose-500 text-rose-300 ring-2 ring-rose-500/40 scale-[1.02]"
                        : "bg-surface-subtle border-surface-border text-gray-400"
                    }`}
                  >
                    <span>Add Related Accessory to Cart</span>
                    <span className="text-[10px] font-mono text-rose-400/80">Visual Look-Alike Trap</span>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 font-mono flex items-center justify-between pt-2 border-t border-surface-border">
                  <span>State: {demoStep.toUpperCase()}</span>
                  <span className="text-amber-400">Environment: shop-0</span>
                </div>
              </div>

              {/* Live ACBE Engine Decision Panel */}
              <div className="flex flex-col justify-between h-full space-y-4">
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    ACBE Diagnostics & Action
                  </div>

                  {demoStep === "idle" && (
                    <div className="p-4 rounded-xl bg-surface-subtle border border-surface-border text-xs text-gray-300 space-y-2">
                      <p className="font-medium text-white">Experience AI Self-Improvement:</p>
                      <p className="text-gray-400 text-xs">
                        See how a naive agent gets tricked by look-alike buttons, and how ACBE autonomously creates and verifies a permanent fix.
                      </p>
                      <button
                        onClick={runHeroDemo}
                        className="mt-3 px-4 py-2 rounded-lg bg-accent text-black font-bold text-xs hover:bg-accent-hover transition-all flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" /> Start 10s Demo
                      </button>
                    </div>
                  )}

                  {(demoStep === "failing" || demoStep === "failed") && (
                    <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs space-y-2.5 animate-in fade-in">
                      <div className="flex items-center gap-2 text-rose-400 font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Trap Detected: WRONG_ELEMENT</span>
                      </div>
                      <p className="text-gray-300 text-xs leading-relaxed">
                        The naive agent used visual text matching and clicked the look-alike accessory button instead of the main product.
                      </p>
                      <div className="pt-2">
                        <button
                          onClick={runAutoImprove}
                          disabled={demoStep === "failing"}
                          className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold text-xs hover:from-amber-400 hover:to-amber-500 transition-all flex items-center justify-center gap-1.5 shadow-lg"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" /> Let ACBE Auto-Improve Now
                        </button>
                      </div>
                    </div>
                  )}

                  {demoStep === "improving" && (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2 animate-in fade-in">
                      <div className="flex items-center gap-2 text-amber-400 font-bold">
                        <RotateCcw className="w-4 h-4 animate-spin" />
                        <span>Synthesizing Counterfactuals...</span>
                      </div>
                      <p className="text-gray-300 text-xs font-mono">
                        Ranking candidates ➔ Testing in sandbox ➔ Z-score verification...
                      </p>
                    </div>
                  )}

                  {demoStep === "success" && (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2.5 animate-in fade-in">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Promoted & Learned: verify_before_click</span>
                      </div>
                      <p className="text-gray-300 text-xs leading-relaxed">
                        Statistical gate approved new strategy: Accessibility DOM disambiguates look-alike buttons. <strong>100% success rate, transferred to memory!</strong>
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={resetDemo}
                          className="px-3 py-1.5 rounded-lg bg-surface-subtle text-gray-300 border border-surface-border text-xs hover:text-white"
                        >
                          ↻ Replay Demo
                        </button>
                        <Link
                          href="/console/liverun"
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30"
                        >
                          Open Live Viewport ➔
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* Metrics ticker */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border grid grid-cols-3 gap-2 text-center text-[11px] font-mono">
                  <div>
                    <span className="text-gray-500 block">Z-Score Conf</span>
                    <span className="text-emerald-400 font-bold">1.000 (Pass)</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Token Ratio</span>
                    <span className="text-amber-400 font-bold">2.05x (OK)</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Regression</span>
                    <span className="text-emerald-400 font-bold">0.0%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
