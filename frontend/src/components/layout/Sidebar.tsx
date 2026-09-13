"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Zap,
  FlaskConical,
  Database,
  Play,
  GitFork,
  BarChart3,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api";

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const [activeAgent, setActiveAgent] = useState<string>("—");
  const [activeStrategy, setActiveStrategy] = useState<string>("—");

  useEffect(() => {
    api.getOverview().then((data) => {
      setActiveAgent(data.active_agent_version || "—");
      setActiveStrategy(data.active_strategy_version || "—");
    }).catch(() => {});
  }, []);

  const navItems = [
    { href: "/console", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
    { href: "/console/failures", label: "Failure Lab", icon: <Search className="w-4 h-4" /> },
    { href: "/console/strategies", label: "Strategy Lab", icon: <Zap className="w-4 h-4" /> },
    { href: "/console/experiments", label: "Experiments", icon: <FlaskConical className="w-4 h-4" /> },
    { href: "/console/memory", label: "Memory", icon: <Database className="w-4 h-4" /> },
    { divider: true },
    { href: "/console/liverun", label: "Live Run", icon: <Play className="w-4 h-4" /> },
    { href: "/console/evolution", label: "Evolution Tree", icon: <GitFork className="w-4 h-4" /> },
    { href: "/console/benchmarks", label: "Benchmark Hub", icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-60 bg-[#0a0c10] border-r border-surface-border flex flex-col justify-between h-screen sticky top-0 shrink-0 select-none">
      <div>
        {/* Brand Header */}
        <div className="p-5 border-b border-surface-border flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="font-mono font-black text-lg tracking-tight text-white group-hover:text-amber-400 transition-colors">
              <span className="text-amber-400">AC</span>BE
            </span>
            <span className="text-xs font-mono text-gray-400 px-1.5 py-0.5 rounded bg-surface-subtle border border-surface-border">
              Console
            </span>
          </Link>
          <Link href="/" title="Back to Landing Page" className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>

        {/* Navigation List */}
        <nav className="p-3 space-y-1">
          {navItems.map((item, idx) => {
            if (item.divider) {
              return <div key={idx} className="h-px bg-surface-border my-2.5 mx-2" />;
            }

            const isActive = pathname === item.href;
            return (
              <Link
                key={idx}
                href={item.href!}
                className={`flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? "bg-accent-subtle text-amber-400 font-bold border border-amber-500/20 shadow-sm"
                    : "text-gray-400 hover:text-white hover:bg-surface-subtle"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Active Version Status in Footer */}
      <div className="p-4 border-t border-surface-border bg-[#080a0e] text-xs font-mono space-y-1.5">
        <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Active Lineage</div>
        <div className="flex items-center justify-between text-gray-400">
          <span>agent:</span>
          <span className="text-amber-400 font-semibold">{activeAgent}</span>
        </div>
        <div className="flex items-center justify-between text-gray-400">
          <span>strategy:</span>
          <span className="text-emerald-400 font-semibold truncate max-w-[110px]">{activeStrategy}</span>
        </div>
      </div>
    </aside>
  );
};
