"use client";

import React, { useState, useEffect } from "react";
import {
  Play,
  Zap,
  Globe,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  Coins,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Target,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { Task, RunResult, ImproveResult, TrajectoryStep } from "@/lib/types";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { Topbar } from "@/components/layout/Topbar";
import { getFriendlyTaskName, getFriendlyTaxonomyName } from "@/lib/utils";

export default function LiveRunPage() {
  const { addToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [customLocator, setCustomLocator] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [improveResult, setImproveResult] = useState<ImproveResult | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const [isImproving, setIsImproving] = useState<boolean>(false);

  const loadTasks = () => {
    api
      .getTasks()
      .then((data) => {
        setTasks(data);
        if (data.length > 0 && !selectedTaskId) {
          setSelectedTaskId(data[0].task_id);
          setCustomLocator(data[0].baseline_locator);
        }
      })
      .catch((err) => {
        addToast("Failed to load task catalogue: " + err.message, "error");
      });
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleTaskChange = (taskId: string) => {
    setSelectedTaskId(taskId);
    const t = tasks.find((item) => item.task_id === taskId);
    if (t) {
      setCustomLocator(t.baseline_locator);
    }
    setRunResult(null);
    setImproveResult(null);
  };

  const handleRunTask = async () => {
    if (!selectedTaskId) return;
    setIsLoading(true);
    setImproveResult(null);
    try {
      const res = await api.runTask(selectedTaskId, customLocator || null);
      setRunResult(res);
      setActiveStepIdx(res.steps.length > 0 ? res.steps.length - 1 : 0);
      if (res.success) {
        addToast(`Task completed successfully! Invariants satisfied.`, "success");
      } else {
        addToast(`Target trap triggered: ${res.error || "Execution interrupted"}`, "warning");
      }
    } catch (err: any) {
      addToast(err.message || "Failed to execute browser task", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerImprovement = async () => {
    if (!selectedTaskId) return;
    setIsImproving(true);
    try {
      const res = await api.improveTask(selectedTaskId);
      setImproveResult(res);
      if (res.improvement && res.improvement.promoted) {
        addToast("Autonomous improvement completed! New strategy promoted to memory.", "success");
      } else if (res.improvement_triggered) {
        addToast("Self-healing loop evaluated. Candidate indexed in sandbox.", "info");
      } else {
        addToast("Initial trajectory succeeded. No remediation needed.", "info");
      }
    } catch (err: any) {
      addToast(err.message || "Improvement failed", "error");
    } finally {
      setIsImproving(false);
    }
  };

  const currentStep: TrajectoryStep | undefined =
    runResult && runResult.steps.length > 0 ? runResult.steps[activeStepIdx] : undefined;

  const currentTask = tasks.find((t) => t.task_id === selectedTaskId);

  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title="Interactive Virtual Browser Viewport"
        description="Dispatch browser navigation flows, inspect DOM element trajectories, and observe automated self-healing."
        onRefresh={loadTasks}
      />

      <div className="p-8 space-y-6">
        {/* Task Selector Bar */}
        <div className="p-5 rounded-2xl bg-surface border border-surface-border backdrop-blur-md grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-5">
            <label className="block text-xs font-mono text-gray-400 mb-1.5 uppercase tracking-wider font-semibold">
              Select Browser Flow Scenario
            </label>
            <select
              value={selectedTaskId}
              onChange={(e) => handleTaskChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-white text-sm focus:outline-none focus:border-amber-500 transition-colors font-sans"
            >
              {tasks.map((t) => (
                <option key={t.task_id} value={t.task_id}>
                  {getFriendlyTaskName(t.task_id)}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4">
            <label className="block text-xs font-mono text-gray-400 mb-1.5 uppercase tracking-wider font-semibold">
              Target Element Selector Strategy
            </label>
            <input
              type="text"
              value={customLocator}
              onChange={(e) => setCustomLocator(e.target.value)}
              placeholder="e.g. text_visual, #submit-order"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/10 text-amber-300 text-sm focus:outline-none focus:border-amber-500 font-mono transition-colors"
            />
          </div>

          <div className="lg:col-span-3 flex items-center gap-2 pt-2 lg:pt-5">
            <button
              onClick={handleRunTask}
              disabled={isLoading || isImproving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-xs shadow-lg shadow-amber-500/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Run Browser Flow
                </>
              )}
            </button>

            <button
              onClick={handleTriggerImprovement}
              disabled={isLoading || isImproving}
              className="px-3.5 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-border text-amber-400 border border-amber-500/20 font-semibold text-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
              title="Trigger Counterfactual Repair Loop"
            >
              {isImproving ? (
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              <span>Auto-Heal</span>
            </button>
          </div>
        </div>

        {/* Scenario Context Strip */}
        {currentTask && (
          <div className="px-5 py-3 rounded-xl bg-surface/40 border border-surface-border flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">Target Scenario:</span>
              <span className="text-white font-semibold">{currentTask.description}</span>
            </div>
            <div className="flex items-center gap-4 text-gray-400 font-mono text-[11px]">
              <span>Category: <strong className="text-amber-400">{currentTask.category}</strong></span>
              <span>Environment: <strong className="text-gray-300">{currentTask.environment_id}</strong></span>
            </div>
          </div>
        )}

        {/* Viewport + Telemetry Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Virtual Browser Viewport (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl bg-surface border border-surface-border overflow-hidden shadow-2xl">
              {/* Browser Header Chrome */}
              <div className="bg-[#0a0d12] px-4 py-3 border-b border-surface-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70 inline-block"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70 inline-block"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70 inline-block"></span>
                  <div className="ml-3 px-3 py-1 rounded-lg bg-[#07080a] border border-white/5 text-[11px] font-mono text-gray-400 flex items-center gap-2">
                    <Globe className="w-3 h-3 text-gray-500" />
                    https://store.acbe-demo.internal/app/flow/{selectedTaskId || "checkout"}
                  </div>
                </div>

                <div>
                  {runResult ? (
                    runResult.success ? (
                      <Pill variant="promoted">Success Verified</Pill>
                    ) : (
                      <Pill variant="retired">Trap Interception</Pill>
                    )
                  ) : (
                    <Pill variant="experimental">Ready</Pill>
                  )}
                </div>
              </div>

              {/* Viewport Canvas */}
              <div className="p-6 min-h-[360px] bg-gradient-to-b from-[#0a0d12]/90 to-[#07080a] relative">
                {isLoading ? (
                  <div className="h-72 flex flex-col items-center justify-center text-center space-y-3">
                    <RotateCcw className="w-7 h-7 text-amber-400 animate-spin" />
                    <p className="text-sm font-semibold text-white">Executing Browser Trajectory...</p>
                    <p className="text-xs text-gray-400 font-mono">Traversing DOM tree, evaluating selectors & invariant guards</p>
                  </div>
                ) : !runResult ? (
                  <div className="h-72 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-white/10 rounded-xl">
                    <Globe className="w-10 h-10 text-gray-600 mb-3" />
                    <h3 className="text-sm font-bold text-white">Browser Ready to Dispatch</h3>
                    <p className="text-xs text-gray-400 max-w-sm mt-1">
                      Select a scenario above and click &quot;Run Browser Flow&quot; to observe live element interactions and telemetry.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Execution Status Banner */}
                    <div
                      className={`p-4 rounded-xl border ${
                        runResult.success
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                      } flex items-start gap-3`}
                    >
                      {runResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="text-xs font-bold uppercase tracking-wider">
                          {runResult.success ? "Trajectory Verified" : "Navigation Trap Triggered"}
                        </div>
                        <div className="text-xs mt-1 text-gray-300">
                          {runResult.error || "All target elements successfully interacted and validated."}
                        </div>
                      </div>
                    </div>

                    {/* Active Step DOM Inspection */}
                    {currentStep && (
                      <div className="rounded-xl bg-[#07080a] border border-white/10 p-5 space-y-4">
                        <div className="flex items-center justify-between text-xs border-b border-white/5 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-amber-400 font-bold">
                              ACTION #{activeStepIdx + 1} OF {runResult.steps.length}
                            </span>
                            <span className="text-gray-600">|</span>
                            <span className="text-gray-300 font-mono">View: {currentStep.page_type}</span>
                          </div>
                          <div className="flex items-center gap-3 text-gray-400 font-mono text-[11px]">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-gray-500" /> {currentStep.latency_ms}ms
                            </span>
                            <span className="flex items-center gap-1">
                              <Coins className="w-3.5 h-3.5 text-amber-400" /> {currentStep.tokens} tokens
                            </span>
                          </div>
                        </div>

                        {/* Visual Target Element Card */}
                        <div className="p-4 rounded-xl bg-surface/60 border border-amber-500/30 relative">
                          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono border border-amber-500/30">
                            <Target className="w-3 h-3" /> Target Element
                          </div>
                          <div className="text-xs text-gray-400 mb-1 font-mono">Interacted Element Node:</div>
                          <div className="text-xs font-mono text-white font-semibold flex items-center gap-1.5 flex-wrap">
                            <span className="text-amber-400">&lt;</span>
                            <span className="text-rose-400">element</span>
                            <span className="text-sky-400">target</span>
                            <span>=</span>
                            <span className="text-emerald-300">&quot;{currentStep.target}&quot;</span>
                            <span className="text-gray-400">locator</span>
                            <span>=</span>
                            <span className="text-amber-300">&quot;{currentStep.locator}&quot;</span>
                            <span className="text-amber-400">&gt;</span>
                          </div>
                        </div>

                        {/* Visible Elements Detected */}
                        <div>
                          <div className="text-[10px] font-mono uppercase text-gray-400 mb-1.5 font-semibold">
                            Visible Interactive Elements:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {currentStep.visible_elements.map((el, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-1 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-gray-300"
                              >
                                {el}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step Navigation Bar */}
              {runResult && runResult.steps.length > 0 && (
                <div className="bg-[#0a0d12] px-4 py-3 border-t border-surface-border flex items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                    {runResult.steps.map((s, idx) => (
                      <button
                        key={s.step_id}
                        onClick={() => setActiveStepIdx(idx)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
                          activeStepIdx === idx
                            ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                            : s.success
                            ? "bg-surface-subtle text-gray-300 hover:bg-surface-border"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {s.success ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-rose-400" />
                        )}
                        Action #{idx + 1}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-gray-400 font-mono whitespace-nowrap pl-4">
                    Session Cost: <strong className="text-white">{runResult.total_tokens} tokens</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Quick Auto-Heal Banner */}
            {runResult && !runResult.success && !improveResult && (
              <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-surface to-surface border border-amber-500/30 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      Counterfactual Remediation Available
                    </h4>
                    <p className="text-xs text-gray-300 mt-0.5">
                      Trigger ACBE self-healing to synthesize alternate selectors and validate recovery in the shadow sandbox.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleTriggerImprovement}
                  disabled={isImproving}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all flex items-center gap-1.5 shrink-0 shadow-md shadow-amber-500/10"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Launch Self-Heal
                </button>
              </div>
            )}
          </div>

          {/* Telemetry & Action Sequence (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Self-Improvement Result Box */}
            {improveResult && improveResult.improvement && (
              <div className="p-5 rounded-2xl bg-surface border border-emerald-500/30 space-y-4">
                <div className="flex items-center justify-between border-b border-surface-border pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Self-Healing Diagnostic Result
                    </h3>
                  </div>
                  {improveResult.improvement.promoted ? (
                    <Pill variant="promoted">Promoted to Memory</Pill>
                  ) : (
                    <Pill variant="experimental">Sandbox Validated</Pill>
                  )}
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-gray-400 block text-[11px] font-mono">Diagnosed Failure Class:</span>
                    <span className="text-rose-400 font-semibold mt-0.5 block">
                      {getFriendlyTaxonomyName(improveResult.improvement.failure_type)}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-400 block text-[11px] font-mono">Root Cause Analysis:</span>
                    <p className="text-gray-200 mt-1 bg-[#0a0d12] p-3 rounded-xl border border-white/5 leading-relaxed text-xs">
                      {improveResult.improvement.root_cause}
                    </p>
                  </div>

                  <div>
                    <span className="text-gray-400 block text-[11px] font-mono mb-1.5">
                      Counterfactual Candidate Selector:
                    </span>
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono text-xs flex items-center justify-between">
                      <span>{improveResult.improvement.top_candidate || "ARIA semantic locator"}</span>
                      <span className="text-[10px] uppercase font-bold text-emerald-400">Winning Strategy</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action History Feed */}
            <div className="p-5 rounded-2xl bg-surface border border-surface-border space-y-4">
              <div className="flex items-center justify-between border-b border-surface-border pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Interaction Trajectory
                  </h3>
                </div>
                <span className="text-xs font-mono text-gray-400">
                  {runResult ? `${runResult.steps.length} Actions` : "0 Actions"}
                </span>
              </div>

              {!runResult ? (
                <div className="py-12 text-center text-gray-500 text-xs">
                  Trajectory history will display as the browser executes actions.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
                  {runResult.steps.map((step, idx) => (
                    <div
                      key={step.step_id}
                      onClick={() => setActiveStepIdx(idx)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        activeStepIdx === idx
                          ? "bg-surface-subtle border-amber-500/40 shadow-sm"
                          : "bg-[#0a0d12] border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-mono text-amber-400 font-semibold text-[11px]">
                          Action #{idx + 1}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                            step.success
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {step.success ? "VERIFIED" : "INTERCEPTED"}
                        </span>
                      </div>

                      <div className="text-xs text-white font-medium flex items-center gap-1.5">
                        <span className="text-amber-400 uppercase font-mono text-[11px] font-bold">
                          {step.action_type}
                        </span>
                        <ChevronRight className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-200 truncate">{step.target}</span>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-400 font-mono">
                        <span>Latency: {step.latency_ms}ms</span>
                        <span>Cost: {step.tokens} tokens</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
