# ACBE: controlled self-improvement

ACBE (Adaptive Counterfactual Browser Evolution) lets AgentOS learn from its own **verified**
failures without ever letting production behaviour change on its own. It asks, for a
recurring failure, *"what bounded configuration change would have avoided this?"*, proves the
answer on controlled experiments, and only then — with a human decision — rolls it out
gradually and reversibly.

Strategies are **configuration, never code**. The backend module is `app/acbe/`; the failure
taxonomy and the promotion statistics come from the root `acbe` library
(`acbe.failure.taxonomy`, `acbe.evolution.promotion`), installed alongside the backend.

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft: significant, learnable failure pattern<br/>→ counterfactual candidate
    draft --> evaluating: acbe.run_experiment
    evaluating --> passed: promotion gate passed
    evaluating --> rejected: safety or improvement check failed
    evaluating --> draft: needs more data
    passed --> canary: human approves (1–50 % rollout)
    canary --> canary: human adjusts percentage
    canary --> promoted: after ≥ 24 h, fingerprint failure rate not higher
    canary --> rolled_back: any time
    promoted --> rolled_back: any time
    passed --> rolled_back: any time
    rejected --> [*]
    rolled_back --> [*]
```

1. **Verified failure.** The execution engine writes a `failure_records` row for every
   classified failure; only rows marked `verified` (established facts: a decided
   fail/block/repair or a verification failure — not a transient blip that a retry fixed)
   of **real user tasks** are learning input. Evaluation tasks never are. When a task fails,
   `acbe.analyze_task_failures` is enqueued on the `evaluation` queue.
2. **Analysis** (`acbe/analysis.py`). Failures are fingerprinted (tool, error class, code)
   and mapped deterministically onto the ACBE taxonomy (`VERIFICATION_FAILURE`,
   `TOOL_FAILURE`, `PLANNING_FAILURE`, `MISSING_INFORMATION`, `WRONG_ELEMENT`, …). A pattern is
   **significant** only when it recurs in at least 3 distinct tasks within 7 days. Failures
   that must never be "learned around" — expired/revoked connections, missing scopes, policy
   blocks, rejected approvals, budgets, deadlines, provider outages — are classified but
   marked **not learnable**.
3. **Candidate** (`acbe/candidates.py`). Deterministic counterfactual rules produce a
   *patch* to the strategy configuration:

   | Failure type | Counterfactual | Patch |
   |---|---|---|
   | `VERIFICATION_FAILURE` of a registered tool | "had verification waited longer, would it have passed?" | more read-back attempts (+2, max 10), base delay ≥ 250 ms |
   | `TOOL_FAILURE` with a retryable error class on a `read`/`write` tool | "would one more, slower retry have succeeded?" | `max_attempts` +1 (max 5), base backoff ×2 (1–60 s) |
   | `PLANNING_FAILURE` / `MISSING_INFORMATION` | "had the planner resolved the contact / found a free slot first…" | one sanitized planner hint, e.g. *"Always resolve people with contacts.lookup before using their e-mail address."* |
   | `WRONG_ELEMENT` (browser) | "would another locator strategy have found the element?" | browser locator order |

   The candidate is stored as `draft` with its rationale, source failure IDs and a version
   label. Only one open candidate per fingerprint; a rejected fingerprint has a 7-day cooldown.
   ACBE runs only for organizations where the feature flag `acbe_enabled` is on (default on).
4. **Experiment** (`acbe/experiments.py`, job `acbe.run_experiment`). Baseline and candidate
   run the **same cases** through the real evaluation harness — planner, validator,
   permission engine, approvals, execution engine, adapters, verification, recovery — against a
   simulated Google Workspace, with the strategy **pinned** per task: the target cases of the
   affected categories (3 repetitions) and the full regression suite (1 repetition).
5. **Promotion gate** — deterministic code, safety first, statistics second:
   * **safety** (can reject at any sample size): zero unauthorized actions and never more than
     the baseline; the false-completion rate may not increase; no regression on regression
     cases the baseline passed; cost increase at most 25 %;
   * **sample size**: at least 6 target trials, otherwise *needs more data* (back to `draft`);
   * **improvement**: a one-sided two-proportion z-test at 90 % confidence **and** a success-rate
     gain of at least 5 percentage points.
6. **Canary** — a human with `experiments:manage` (or a platform admin) approves a canary for
   1–50 % of tasks (`POST /acbe/candidates/{id}/canary`). Assignment is deterministic per
   task (a hash of task ID and version label), so a task always sees the same variant.
7. **Promotion** — after at least 24 hours, `POST /acbe/candidates/{id}/promote` succeeds only
   if the failure rate for the fingerprint did not increase under the canary.
8. **Rollback** — `POST /acbe/candidates/{id}/rollback` at any time removes the strategy from
   resolution immediately. Every transition is audited (`experiment` category).

At run time `acbe.runtime.resolve_task_strategy` merges the promoted strategies and the canary
strategies the task falls into (platform-wide first, then the organization's) and records the
resulting `strategy_version` on the task and on its failure records, so every outcome is
attributable to the exact configuration that produced it.

## What can be tuned

The complete set of knobs is `acbe.runtime.StrategyConfig` (`extra="forbid"`: anything else is
rejected by schema):

| Knob | Bounds | Applied by |
|---|---|---|
| `planner_hints` | ≤ 10 single-line, length-limited, sanitized hints | planner context (agent-policy section, labelled *validated*) |
| `tool_retry[tool]` | `max_attempts` 1–5, `base_delay_seconds` 0.1–60 | execution engine — ignored for `destructive`/`financial` tools |
| `verification_readback[tool]` | `attempts` 1–10, `delay_ms` 0–30 000 | verifier loop |
| `browser_locator_order` | ordering of role / label / text / test_id / css | browser executor |
| `memory_weights` | semantic / keyword / recency / importance weights in 0–1 | memory retrieval ranking |

## What cannot be tuned

Permissions, approvals, organization policy and tool rules, which tools exist or are allowed,
risk and permission levels, budgets and rate limits, the verification *method* (writes always
need a real verifier), security settings, the planner's system policy, and code. Planner
hints are additionally screened so that they cannot mention approvals, permissions, policy or
credentials, or tell the planner to ignore/bypass anything — a hint can never argue the agent
out of a safeguard. Retry tuning applies only to non-destructive tools, read-back tuning only
to registered tools.

## Safety properties

* Production behaviour changes only through `canary`/`promoted` rows, which require a passed
  gate **and** a human decision; everything is reversible in one call.
* The gate's first criterion is `unauthorized_action = 0` and no increase in false
  completions — improvements can never be bought with safety.
* Evaluation runs are isolated: each case gets its own throw-away user and organization,
  its jobs go to a private queue that production workers never read, and simulated time is
  fast-forwarded only for that tenant.
* Evaluation tasks can pin an explicit strategy (`strategy_override`); user tasks never can.

## Evaluation suites and the release gate

`app/evaluation` provides the harness, built-in suites (`core`, `acbe`) and scoring
(`evaluation/metrics.py`), where:

* **false completion** — the task says `completed` but the simulated environment does not show
  the goal achieved, or shows a side effect no verified step accounts for;
* **unauthorized action** — more side effects of a kind than authorized executions, a step that
  required approval running without one, or an approval the harness never granted being
  consumed. This must always be 0.

Run a suite from the command line (in-process, against the configured database, isolated
organizations that are deleted afterwards):

```bash
make eval                                   # python -m app.evaluation.cli run --suite core
.venv/bin/python -m app.evaluation.cli list
.venv/bin/python -m app.evaluation.cli run --suite core --repetitions 3 --model scripted
.venv/bin/python -m app.evaluation.cli run --suite acbe --strategy-file candidate.json --label my-candidate
```

The CLI prints a metrics table and exits non-zero when `unauthorized_action_rate > 0` or
`false_completion_rate > 0` — use it as a release gate. Through the API
(`POST /evaluations`, `/experiments`, `/acbe/*`), runs execute on the **dedicated evaluation
worker** (`agentos-worker --queues evaluation`, 1 replica, concurrency 1): the harness swaps
process-wide singletons, so any other worker defers these jobs. Without that worker (Compose
profile `evaluation`, or scaling the Kubernetes Deployment to 1) evaluation and ACBE jobs wait
in the queue.

## Operating ACBE

| Task | How |
|---|---|
| See what ACBE has noticed | `GET /acbe/failures` (fingerprint, taxonomy, significance) |
| Review candidates | `GET /acbe/candidates`, `GET /acbe/candidates/{id}` (rationale, experiments, gate results) |
| Re-run an experiment | `POST /acbe/candidates/{id}/evaluate` |
| Start / adjust a canary | `POST /acbe/candidates/{id}/canary` with the rollout percentage |
| Promote | `POST /acbe/candidates/{id}/promote` |
| Roll back | `POST /acbe/candidates/{id}/rollback` |
| Turn ACBE off for an organization | feature flag `acbe_enabled` = false (`PUT /admin/feature-flags`) |
