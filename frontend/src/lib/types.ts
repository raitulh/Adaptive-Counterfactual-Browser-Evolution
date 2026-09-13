export interface OverviewData {
  strategies_total: number;
  strategies_promoted: number;
  experiments_total: number;
  experiments_promoted: number;
  experiments_rejected: number;
  experiments_rolled_back: number;
  failures_total: number;
  failures_by_type: Record<string, number>;
  estimated_tokens_saved: number;
  active_agent_version: string;
  active_strategy_version: string;
  llm_provider?: string;
  llm_available?: boolean;
}

export interface Task {
  task_id: string;
  category: string;
  description: string;
  baseline_locator: string;
  environment_id: string;
}

export interface StepVerification {
  verified: boolean;
  method: string;
  detail: string;
  actual_state: string;
}

export interface TrajectoryStep {
  step_id: string;
  action_type: string;
  target: string;
  locator: string;
  params: Record<string, unknown>;
  tokens: number;
  latency_ms: number;
  success: boolean;
  page_type: string;
  visible_elements: string[];
  verification: StepVerification | null;
}

export interface RunResult {
  task_id: string;
  category: string;
  description: string;
  locator: string;
  success: boolean;
  error: string | null;
  total_tokens: number;
  steps: TrajectoryStep[];
}

export interface ImprovementOutcome {
  failure_type: string;
  root_cause: string;
  candidates_ranked: string[];
  top_candidate: string | null;
  promoted: boolean;
  experiment?: {
    experiment_id: string;
    status: string;
    decision_reason: string;
    improvement_gain: number;
    token_increase_ratio?: number;
  };
}

export interface ImproveResult {
  task_id: string;
  initial_success: boolean;
  improvement_triggered: boolean;
  improvement: ImprovementOutcome | null;
  summary: Record<string, unknown>;
}

export interface FailureRecord {
  fingerprint_id: string;
  task_id: string;
  failure_type: string;
  confidence: number;
  error: string;
  timestamp?: number;
}

export interface StrategyRecord {
  strategy_id: string;
  failure_pattern: string;
  actions: Array<{ locator_strategy?: string; type?: string }>;
  lifecycle: 'DRAFT' | 'EXPERIMENTAL' | 'VALIDATED' | 'PROMOTED' | 'RETIRED' | 'ROLLED_BACK';
  successes: number;
  trials: number;
  transfer_successes: number;
  transfer_trials: number;
  environments_seen?: string[];
  risk?: number;
  version?: string;
}

export interface ExperimentRecord {
  experiment_id: string;
  status: 'PROMOTE' | 'REJECT' | 'NEEDS_MORE_DATA' | 'ROLLBACK';
  strategy: string;
  baseline_successes: number;
  baseline_trials: number;
  candidate_successes: number;
  candidate_trials: number;
  token_increase_ratio?: number;
  decision_reason?: string;
}

export interface VersionEntry {
  version: string;
  parent_version: string | null;
  kind: 'agent' | 'strategy';
  created_at: number;
  metadata?: Record<string, unknown>;
}

export interface EvolutionTreeData {
  active_agent: string;
  active_strategy: string;
  agent_versions: VersionEntry[];
  strategy_versions: VersionEntry[];
}

export interface BenchmarkCategory {
  category: string;
  tasks: number;
  trap: string;
  baseline_success: number;
  acbe_success: number;
}

export interface BenchmarkResultsData {
  suite_name: string;
  total_tasks: number;
  categories_count: number;
  baseline: {
    name: string;
    success_rate: number;
    avg_tokens: number;
  };
  acbe: {
    name: string;
    recovery_rate: number;
    transfer_success_rate: number;
    regression_rate: number;
  };
  category_breakdown: BenchmarkCategory[];
}
