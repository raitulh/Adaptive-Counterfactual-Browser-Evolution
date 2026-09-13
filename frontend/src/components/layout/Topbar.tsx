"use client";

import React, { useState } from "react";
import { Plus, RefreshCw, Terminal, ExternalLink, ShieldCheck } from "lucide-react";
import { RunTaskModal } from "@/components/modals/RunTaskModal";
import { useToast } from "@/components/ui/Toast";

interface TopbarProps {
  title: string;
  description: string;
  onRefresh?: () => void;
  badge?: string;
}

export const Topbar: React.FC<TopbarProps> = ({ title, description, onRefresh, badge }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const { showToast } = useToast();

  const handleRefresh = () => {
    if (onRefresh) onRefresh();
    showToast("Dashboard telemetry refreshed", "info");
  };

  return (
    <>
      <header className="px-8 py-5 border-b border-surface-border bg-[#0a0d12] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-white tracking-tight">{title}</h1>
            {badge && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Autonomous Engine Ready</span>
          </div>

          <button
            onClick={handleRefresh}
            className="p-2 rounded-xl text-gray-400 hover:text-white bg-surface-subtle hover:bg-surface-border border border-surface-border transition-colors text-xs flex items-center gap-1.5"
            title="Refresh telemetry records"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-md flex items-center gap-1.5 shadow-amber-500/10 hover:shadow-amber-500/20"
          >
            <Plus className="w-4 h-4" /> Run Task
          </button>
        </div>
      </header>

      <RunTaskModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};
