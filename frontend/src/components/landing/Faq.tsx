"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

export const Faq: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: "Does ACBE require retraining or fine-tuning the model's weights?",
      a: "No. ACBE is a procedural learning layer. It generates, tests, and promotes grounded locator strategies, observation representations, and model routing rules stored in persistent SQLite memory—costing zero model retraining dollars.",
    },
    {
      q: "How does ACBE prevent regressions when new strategies are learned?",
      a: "Every candidate strategy must pass through a strict statistical promotion gate. It is evaluated against both the target failure task and a held-out regression suite. If any previously working task breaks, the candidate is rejected automatically.",
    },
    {
      q: "Can the AI agent alter its own evaluation or safety rules?",
      a: "Never. Hard architectural boundaries permanently protect the independent evaluator, benchmark specifications, and audit logging. The self-improvement loop can only propose and promote strategies, not rewrite its own safety guardrails.",
    },
    {
      q: "Which AI models and agent frameworks does ACBE support?",
      a: "ACBE is model-agnostic. It works with local Ollama models, Claude, OpenAI, custom Python agents, Playwright browser scripts, and LangGraph/CrewAI workflows.",
    },
  ];

  return (
    <section className="py-20 px-6 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Frequently Asked Questions</h2>
        <p className="mt-2 text-sm text-gray-400">Technical transparency on what ACBE claims and guarantees.</p>
      </div>

      <div className="space-y-3">
        {faqs.map((faq, i) => (
          <div
            key={i}
            className="glass-panel rounded-xl overflow-hidden border border-white/[0.08] transition-colors"
          >
            <button
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              className="w-full px-5 py-4 text-left font-semibold text-sm text-white flex items-center justify-between"
            >
              <span>{faq.q}</span>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  openIndex === i ? "rotate-180 text-amber-400" : ""
                }`}
              />
            </button>
            {openIndex === i && (
              <div className="px-5 pb-4 text-xs text-gray-300 leading-relaxed border-t border-white/[0.04] pt-3">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
