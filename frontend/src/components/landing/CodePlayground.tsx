"use client";

import React, { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";

export const CodePlayground: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"python" | "cli" | "curl">("python");
  const [copied, setCopied] = useState(false);

  const snippets = {
    python: `# 1. Import ACBE and wrap your existing agent:
from acbe import ACBE
from acbe.agents.custom_agent import ScriptedAgent
from benchmarks.environments import make_shop_environment

# 2. Attach your agent to an environment:
env = make_shop_environment("my-shop", trap=True)
agent = ScriptedAgent(steps=[...], locator_strategy="text_visual")
system = ACBE(agent=agent, browser="mock", environment=env)

# 3. Execute with continuous self-improvement:
result = system.run_and_improve("Add product to cart and checkout")
print(result.success, result.improvement_triggered)
# -> Trapped on attempt 1, diagnosed root cause, promoted verify_before_click, 100% success!`,

    cli: `# Initialize the ACBE SQLite strategy database:
acbe init

# Run task wrong_element_0 (fails with naive locator by design):
acbe run --task wrong_element_0

# Trigger the full self-improvement loop:
acbe improve --task wrong_element_0

# Inspect newly promoted strategies in procedural memory:
acbe strategies

# Launch the Next.js developer console:
acbe serve`,

    curl: `# Execute a task via REST API:
curl -X POST http://127.0.0.1:8420/api/tasks/run \\
  -H "Content-Type: application/json" \\
  -d '{"task_id": "wrong_element_0"}'

# Trigger autonomous self-improvement for a task:
curl -X POST http://127.0.0.1:8420/api/tasks/improve \\
  -H "Content-Type: application/json" \\
  -d '{"task_id": "wrong_element_0"}'`,
  };

  const copyCode = () => {
    navigator.clipboard.writeText(snippets[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="code" className="py-24 px-6 max-w-5xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <div className="text-xs font-mono font-bold uppercase tracking-wider text-sky-400 mb-2">
          Developer Integration
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Drop Into <span className="text-gradient">Any Codebase</span> in Minutes
        </h2>
        <p className="mt-3 text-sm text-gray-400">
          Model-agnostic: wrap custom Python agents, Playwright automation, LangGraph, or call via JSON API.
        </p>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
        {/* Header Tabs */}
        <div className="bg-[#0e1117] px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex gap-2">
            {(["python", "cli", "curl"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-mono transition-all ${
                  activeTab === tab
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab === "python" ? "Python SDK" : tab === "cli" ? "ACBE CLI" : "REST API"}
              </button>
            ))}
          </div>

          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs text-gray-400 hover:text-white bg-surface-subtle border border-surface-border transition-colors font-mono"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>

        {/* Code View */}
        <div className="p-6 bg-[#07080b] font-mono text-xs text-gray-200 overflow-x-auto leading-relaxed">
          <pre className="text-amber-200/90 whitespace-pre">{snippets[activeTab]}</pre>
        </div>
      </div>
    </section>
  );
};
