"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Play, Zap, Compass } from "lucide-react";
import { Task } from "@/lib/types";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { getFriendlyTaskName } from "@/lib/utils";

interface RunTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RunTaskModal: React.FC<RunTaskModalProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string>("");
  const [selectedLocator, setSelectedLocator] = useState<string>("");
  const [mode, setMode] = useState<"run" | "improve">("run");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && !tasks.length) {
      api.getTasks().then((data) => {
        setTasks(data);
        if (data.length) setSelectedTask(data[0].task_id);
      }).catch((err) => {
        console.error("Failed to load tasks", err);
      });
    }
  }, [isOpen, tasks.length]);

  if (!isOpen) return null;

  const currentTask = tasks.find((t) => t.task_id === selectedTask);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setLoading(true);

    try {
      if (mode === "improve") {
        showToast(`Triggering autonomous remediation for ${getFriendlyTaskName(selectedTask)}...`, "info");
        const res = await api.improveTask(selectedTask);
        if (res.improvement?.promoted) {
          showToast(`✓ Promoted winning strategy to procedural memory!`, "success");
        } else {
          showToast(`Self-improvement run completed. Candidate evaluated in sandbox.`, "info");
        }
      } else {
        showToast(`Executing navigation flow...`, "info");
        const res = await api.runTask(selectedTask, selectedLocator || null);
        showToast(
          res.success
            ? "Task trajectory completed successfully!"
            : `Trap detected: ${res.error || "Execution interrupted"}`,
          res.success ? "success" : "warning"
        );
      }

      onClose();
      router.push(`/console/liverun`);
    } catch (err: any) {
      showToast(`Execution failed: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl border border-white/10 relative">
        <div className="flex items-center justify-between pb-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-accent" />
            <h3 className="text-base font-bold text-white">Execute Browser Navigation Flow</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Select Navigation Scenario
            </label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full bg-[#0a0d12] border border-surface-border rounded-xl px-3.5 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
            >
              {tasks.map((t) => (
                <option key={t.task_id} value={t.task_id}>
                  {getFriendlyTaskName(t.task_id)}
                </option>
              ))}
            </select>
            {currentTask && (
              <p className="mt-2 text-xs text-gray-400">
                Target: <span className="text-gray-200">{currentTask.description}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Locator Strategy
            </label>
            <select
              value={selectedLocator}
              onChange={(e) => setSelectedLocator(e.target.value)}
              className="w-full bg-[#0a0d12] border border-surface-border rounded-xl px-3.5 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
            >
              <option value="">Default Baseline (Text/Visual Heuristic)</option>
              <option value="role_name">Role + Accessible Name</option>
              <option value="verify_before_click">Verify Before Click (Robust)</option>
              <option value="wait_for_ready">Wait For Ready State</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Execution Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-start gap-2.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  mode === "run"
                    ? "bg-accent-subtle border-accent text-white"
                    : "bg-[#0a0d12] border-surface-border text-gray-400 hover:text-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="exec-mode"
                  value="run"
                  checked={mode === "run"}
                  onChange={() => setMode("run")}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5 text-accent" /> Standard Episode
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">Observe agent interaction</div>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  mode === "improve"
                    ? "bg-emerald-500/10 border-emerald-500 text-white"
                    : "bg-[#0a0d12] border-surface-border text-gray-400 hover:text-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="exec-mode"
                  value="improve"
                  checked={mode === "improve"}
                  onChange={() => setMode("improve")}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5 text-emerald-400">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" /> Auto-Heal
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">Diagnose, rank & promote</div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <span>Executing...</span>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" /> Launch Flow
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
