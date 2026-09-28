"""Prometheus metrics. Label sets are deliberately low-cardinality (no user/task IDs)."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

api_requests_total = Counter("api_requests_total", "API requests", ["method", "route", "status"])
api_latency = Histogram(
    "api_latency_seconds", "API request latency", ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
task_created_total = Counter("task_created_total", "Tasks created", ["source"])
task_completed_total = Counter("task_completed_total", "Tasks completed (verified)")
task_failed_total = Counter("task_failed_total", "Tasks failed", ["reason"])
task_state_transitions_total = Counter("task_state_transitions_total", "Task transitions", ["from_state", "to_state"])
verification_pass_total = Counter("verification_pass_total", "Verification passed", ["method"])
verification_fail_total = Counter("verification_fail_total", "Verification failed", ["method"])
tool_calls_total = Counter("tool_calls_total", "Tool calls", ["tool", "outcome"])
tool_error_total = Counter("tool_error_total", "Tool errors", ["tool", "error_class"])
tool_latency = Histogram("tool_latency_seconds", "Tool latency", ["tool"],
                         buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120))
retry_total = Counter("retry_total", "Retries scheduled", ["kind", "error_class"])
approval_requests_total = Counter("approval_requests_total", "Approval requests", ["outcome"])
approval_wait_time = Histogram("approval_wait_time_seconds", "Time from approval request to decision",
                               buckets=(10, 30, 60, 300, 900, 3600, 4 * 3600, 24 * 3600))
model_latency = Histogram("model_latency_seconds", "Model call latency", ["provider", "model"],
                          buckets=(0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120))
model_error_total = Counter("model_error_total", "Model call errors", ["provider", "model", "error"])
model_tokens_total = Counter("model_tokens_total", "Model tokens", ["provider", "model", "direction"])
browser_task_latency = Histogram("browser_task_latency_seconds", "Browser task latency",
                                 buckets=(1, 2, 5, 10, 20, 40, 80, 160))
jobs_processed_total = Counter("jobs_processed_total", "Background jobs processed", ["queue", "job_type", "outcome"])
jobs_in_flight = Gauge("jobs_in_flight", "Jobs currently executing", ["queue"])
rate_limited_total = Counter("rate_limited_total", "Rate-limited requests", ["scope"])
