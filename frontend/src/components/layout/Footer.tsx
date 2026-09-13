import React from "react";
import Link from "next/link";
import { Terminal, Shield, Cpu, RefreshCcw } from "lucide-react";

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-white/[0.08] bg-[#050608] py-16 px-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10 text-sm">
        <div className="space-y-4 md:col-span-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-black text-xl tracking-tight text-white">
              <span className="text-amber-400">AC</span>BE
            </span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Adaptive Counterfactual Browser Evolution — the model-agnostic self-improvement layer for AI agents.
          </p>
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
            Deterministic Promotion Gate Active
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-300 mb-3">Capabilities</h4>
          <ul className="space-y-2 text-xs text-gray-400">
            <li><a href="#how-it-works" className="hover:text-white transition-colors">Verified Failure Analysis</a></li>
            <li><a href="#bento" className="hover:text-white transition-colors">Counterfactual Strategy Generation</a></li>
            <li><a href="#bento" className="hover:text-white transition-colors">Two-Proportion Z-Test Promotion Gate</a></li>
            <li><a href="#bento" className="hover:text-white transition-colors">Zero-Shot Cross-Task Transfer</a></li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-300 mb-3">Engineering Console</h4>
          <ul className="space-y-2 text-xs text-gray-400">
            <li><Link href="/console" className="hover:text-white transition-colors">Console Overview</Link></li>
            <li><Link href="/console/liverun" className="hover:text-white transition-colors">Virtual Browser Viewport</Link></li>
            <li><Link href="/console/failures" className="hover:text-white transition-colors">Failure Lab</Link></li>
            <li><Link href="/console/evolution" className="hover:text-white transition-colors">Version Lineage DAG</Link></li>
            <li><Link href="/console/benchmarks" className="hover:text-white transition-colors">ACBE-Bench Performance</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-300 mb-3">Security & Compliance</h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Permanent safety boundaries: evaluators, benchmark specifications, and audit logs cannot be modified by autonomous loops.
          </p>
          <div className="mt-3 text-[11px] text-gray-500 font-mono">
            MIT Licensed • Open Research
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-12 pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500">
        <div>© 2026 ACBE Contributors. All rights reserved.</div>
        <div className="flex gap-4 mt-2 sm:mt-0">
          <span>Continuous Learning Without Retraining</span>
        </div>
      </div>
    </footer>
  );
};
