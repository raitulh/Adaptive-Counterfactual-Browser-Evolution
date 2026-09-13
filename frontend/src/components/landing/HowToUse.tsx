"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Terminal,
  Play,
  CheckCircle2,
  Cpu,
  Layers,
  ShieldCheck,
  ArrowRight,
  Copy,
  Check,
  Zap,
  Globe,
} from "lucide-react";

export const HowToUse: React.FC = () => {
  const [activeWorkflow, setActiveWorkflow] = useState<"ui" | "python" | "cli">("ui");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <section id="how-to-use" className="py-20 px-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-14">
        <div className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 mb-2">
          User Workflow Guide
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          How to Use <span className="text-gradient">ACBE</span> in 3 Simple Steps
        </h2>
        <p className="mt-3 text-sm text-gray-400">
          Whether you want a visual web console, a Python library for your agents, or a terminal CLI, getting started takes less than 60 seconds.
        </p>

        {/* Workflow Switcher Tabs */}
        <div className="inline-flex p-1.5 rounded-xl bg-surface border border-surface-border mt-8 gap-1">
          <button
            onClick={() => setActiveWorkflow("ui")}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
              activeWorkflow === "ui"
                ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>1. Visual Web Console</span>
          </button>
          <button
            onClick={() => setActiveWorkflow("python")}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
              activeWorkflow === "python"
                ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>2. Python SDK (PyPI)</span>
          </button>
          <button
            onClick={() => setActiveWorkflow("cli")}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
              activeWorkflow === "cli"
                ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>3. Command Line CLI</span>
          </button>
        </div>
      </div>

      {/* 3 Step Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* STEP 1 */}
        <div className="glass-panel rounded-2xl p-6 border border-surface-border flex flex-col justify-between space-y-6 relative overflow-hidden group hover:border-amber-500/40 transition-all">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center font-mono font-bold text-sm">
                01
              </span>
              <span className="text-[11px] font-mono text-gray-500 uppercase">Step 1 • Setup</span>
            </div>

            <h3 className="text-base font-bold text-white">
              {activeWorkflow === "ui" && "Open Web Console"}
              {activeWorkflow === "python" && "Install via PyPI"}
              {activeWorkflow === "cli" && "Initialize Database"}
            </h3>

            <p className="text-xs text-gray-400 leading-relaxed">
              {activeWorkflow === "ui" &&
                "Launch the interactive dashboard in your browser. All 27 synthetic benchmark environments and SQLite stores connect automatically."}
              {activeWorkflow === "python" &&
                "Install the official ACBE package from PyPI into your virtual environment with one command."}
              {activeWorkflow === "cli" &&
                "Initialize your local SQLite memory store and verify your CLI toolchain with zero manual configuration."}
            </p>
          </div>

          {/* Code or Action Preview */}
          <div className="bg-[#090b0e] p-3.5 rounded-xl border border-white/5 font-mono text-xs text-gray-300">
            {activeWorkflow === "ui" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>URL Endpoint</span>
                  <span className="text-emerald-400">ONLINE</span>
                </div>
                <div className="text-amber-400 font-semibold truncate">/console (Interactive Dashboard)</div>
                <Link
                  href="/console"
                  className="mt-2 w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors"
                >
                  Open Console Now <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : activeWorkflow === "python" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">Bash</span>
                  <button
                    onClick={() => copyToClipboard("pip install acbe", "pip")}
                    className="text-gray-400 hover:text-white"
                  >
                    {copiedCode === "pip" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-emerald-400 select-all">$ pip install acbe</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">Bash</span>
                  <button
                    onClick={() => copyToClipboard("acbe init", "init")}
                    className="text-gray-400 hover:text-white"
                  >
                    {copiedCode === "init" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-amber-300 select-all">$ acbe init</div>
              </div>
            )}
          </div>
        </div>

        {/* STEP 2 */}
        <div className="glass-panel rounded-2xl p-6 border border-surface-border flex flex-col justify-between space-y-6 relative overflow-hidden group hover:border-amber-500/40 transition-all">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center font-mono font-bold text-sm">
                02
              </span>
              <span className="text-[11px] font-mono text-gray-500 uppercase">Step 2 • Run & Observe</span>
            </div>

            <h3 className="text-base font-bold text-white">
              {activeWorkflow === "ui" && "Dispatch Virtual Tasks"}
              {activeWorkflow === "python" && "Wrap Your Agent"}
              {activeWorkflow === "cli" && "Execute Task Benchmark"}
            </h3>

            <p className="text-xs text-gray-400 leading-relaxed">
              {activeWorkflow === "ui" &&
                "Select a website task in Live Run. The agent attempts navigation; if it encounters a visual or DOM trap, ACBE records the failure fingerprint."}
              {activeWorkflow === "python" &&
                "Wrap your existing Playwright, LangChain, or CrewAI agent in `ACBE()`. Execution telemetry is captured automatically."}
              {activeWorkflow === "cli" &&
                "Run `acbe run --task wrong_element_0`. Observe action telemetry, token latency, and verification state transitions."}
            </p>
          </div>

          {/* Code or Action Preview */}
          <div className="bg-[#090b0e] p-3.5 rounded-xl border border-white/5 font-mono text-xs text-gray-300">
            {activeWorkflow === "ui" ? (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between text-gray-400">
                  <span>Task:</span>
                  <span className="text-white font-semibold">wrong_element_0</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Target:</span>
                  <span className="text-rose-400">Look-Alike Trap</span>
                </div>
                <div className="text-[10px] text-rose-400/90 pt-1 border-t border-white/5">
                  Verifier: Trapped (DOM mutation mismatch)
                </div>
              </div>
            ) : activeWorkflow === "python" ? (
              <div className="space-y-1.5 text-[11px]">
                <div className="text-sky-400">from acbe import ACBE</div>
                <div className="text-gray-400">system = ACBE(agent=my_agent)</div>
                <div className="text-emerald-400">res = system.run(task)</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">Bash</span>
                  <button
                    onClick={() => copyToClipboard("acbe run --task wrong_element_0", "run")}
                    className="text-gray-400 hover:text-white"
                  >
                    {copiedCode === "run" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-sky-300 select-all">$ acbe run -t wrong_element_0</div>
              </div>
            )}
          </div>
        </div>

        {/* STEP 3 */}
        <div className="glass-panel rounded-2xl p-6 border border-surface-border flex flex-col justify-between space-y-6 relative overflow-hidden group hover:border-amber-500/40 transition-all">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-mono font-bold text-sm">
                03
              </span>
              <span className="text-[11px] font-mono text-gray-500 uppercase">Step 3 • Self-Heal</span>
            </div>

            <h3 className="text-base font-bold text-white">
              {activeWorkflow === "ui" && "Click 'Launch Self-Heal'"}
              {activeWorkflow === "python" && "Automatic Remediation"}
              {activeWorkflow === "cli" && "CLI Auto-Improve"}
            </h3>

            <p className="text-xs text-gray-400 leading-relaxed">
              {activeWorkflow === "ui" &&
                "Click 'Launch Self-Heal' in the console. ACBE + Gemini diagnoses root causes, generates counterfactual alternatives, validates in a sandbox, and saves fixes to memory."}
              {activeWorkflow === "python" &&
                "Call `system.run_and_improve(task)`. Learned strategies transfer zero-shot across new websites without retraining."}
              {activeWorkflow === "cli" &&
                "Run `acbe improve --task wrong_element_0`. New heuristics are stored in SQLite and ready for zero-shot transfer."}
            </p>
          </div>

          {/* Code or Action Preview */}
          <div className="bg-[#090b0e] p-3.5 rounded-xl border border-white/5 font-mono text-xs text-gray-300">
            {activeWorkflow === "ui" ? (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between text-emerald-400">
                  <span className="font-semibold">Strategy Promoted</span>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div className="text-gray-300 text-[10px]">
                  Rule: <span className="text-amber-400">verify_before_click</span>
                </div>
                <div className="text-gray-400 text-[10px]">
                  Transfer rate: <span className="text-white font-bold">100% (0% regression)</span>
                </div>
              </div>
            ) : activeWorkflow === "python" ? (
              <div className="space-y-1.5 text-[11px]">
                <div className="text-emerald-400 font-semibold">outcome = system.improve(task)</div>
                <div className="text-gray-400 text-[10px]"># Promoted to SQLite procedural memory</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">Bash</span>
                  <button
                    onClick={() => copyToClipboard("acbe improve --task wrong_element_0", "improve")}
                    className="text-gray-400 hover:text-white"
                  >
                    {copiedCode === "improve" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-emerald-300 select-all">$ acbe improve -t wrong_element_0</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Visual Live Demonstration Banner */}
      <div className="mt-12 p-6 rounded-2xl bg-gradient-to-r from-surface via-surface to-amber-500/10 border border-surface-border flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="space-y-1.5 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-mono text-amber-400 font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>Ready to try right now</span>
          </div>
          <h4 className="text-lg font-bold text-white">Experience Self-Improvement in Live Run</h4>
          <p className="text-xs text-gray-300 max-w-xl">
            Test a simulated failure on <code>shop-0</code> and trigger ACBE + Gemini counterfactual remediation directly in your browser.
          </p>
        </div>

        <Link
          href="/console/liverun"
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold text-xs hover:from-amber-400 hover:to-amber-500 transition-all flex items-center gap-2 shrink-0 shadow-lg shadow-amber-500/20"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Launch Live Simulator</span>
        </Link>
      </div>
    </section>
  );
};
