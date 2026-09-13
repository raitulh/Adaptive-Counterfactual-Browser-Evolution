import {
  OverviewData,
  Task,
  RunResult,
  ImproveResult,
  FailureRecord,
  StrategyRecord,
  ExperimentRecord,
  EvolutionTreeData,
  BenchmarkResultsData,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error ${res.status}: ${errorText}`);
  }

  return res.json();
}

export const api = {
  getOverview: () => request<OverviewData>("/api/overview"),
  getTasks: () => request<Task[]>("/api/tasks"),
  getFailures: () => request<FailureRecord[]>("/api/failures"),
  getStrategies: () => request<StrategyRecord[]>("/api/strategies"),
  getExperiments: () => request<ExperimentRecord[]>("/api/experiments"),
  searchMemory: (query?: string) =>
    request<StrategyRecord[]>(query ? `/api/memory/search?q=${encodeURIComponent(query)}` : "/api/memory/search"),
  getEvolutionTree: () => request<EvolutionTreeData>("/api/evolution/tree"),
  getBenchmarkResults: () => request<BenchmarkResultsData>("/api/benchmarks/results"),

  runTask: (taskId: string, locator?: string | null) =>
    request<RunResult>("/api/tasks/run", {
      method: "POST",
      body: JSON.stringify({ task_id: taskId, locator: locator || null }),
    }),

  improveTask: (taskId: string) =>
    request<ImproveResult>("/api/tasks/improve", {
      method: "POST",
      body: JSON.stringify({ task_id: taskId }),
    }),

  rollback: (kind: "agent" | "strategy", version: string, reason?: string) =>
    request<{ success: boolean; kind: string; active_version: string }>("/api/rollback", {
      method: "POST",
      body: JSON.stringify({ kind, version, reason }),
    }),
};
