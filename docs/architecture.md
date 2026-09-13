# Architecture

## The central loop

The self-improvement loop (`acbe/self_improvement/loop.py`) is the
orchestrator every other module plugs into:

```
Task -> Agent -> Observe -> Plan -> Act -> Verify -> Result
     -> Evaluator -> Failure/Success Analysis -> Root Cause Analysis
     -> Improvement Proposal -> Counterfactual Strategy Generation
     -> Candidate Ranking -> Experiment -> Evaluation -> Promotion Gate
     -> Keep / Reject / Rollback -> Strategy Memory -> Cross-Task Transfer
     -> Future Execution -> Continuous Learning
```

Six phases are kept structurally distinct (never collapsed into one
function), matching the spec's Section 1 requirement:

| Phase | Module |
|---|---|
| Execution | `acbe.experiments.runner.run_episode` / `acbe.core.executor.run_agent_episode` |
| Evaluation | `acbe.evaluation.evaluator.Evaluator` |
| Diagnosis | `acbe.failure.fingerprint` + `acbe.self_improvement.root_cause` |
| Improvement | `acbe.counterfactual.generator` + `acbe.strategy.ranking` |
| Experimentation | `acbe.experiments.runner.ExperimentRunner` |
| Promotion | `acbe.evolution.promotion.PromotionGate` + `acbe.evolution.rollback.VersionHistory` |

## Module map

```
acbe/
├── core/            Config + zero-dependency dataclasses shared everywhere
├── agents/           AgentAdapter interface + FunctionAgent/ScriptedAgent
├── adapters/         Ollama / OpenAI-compatible (real) + LangGraph / LangChain / CrewAI / MCP (soft-dependency)
├── browser/          BrowserAdapter interface + MockBrowserAdapter (sandbox) + PlaywrightBrowserAdapter (real)
├── observation/       Compact UI state extraction + state hashing/dedup
├── verification/       Wraps backend verification with an "did anything actually change" sanity check
├── failure/            Taxonomy + FailureFingerprint + SQLite-backed FailureStore
├── counterfactual/      Generates multiple candidate Strategy objects per failure
├── strategy/            Strategy/StrategyLifecycle models + the cheap-competition ranking funnel
├── memory/              StrategyMemory interface + SQLite implementation
├── efficiency/           TokenTracker + ModelRouter (adaptive observation/reasoning budget)
├── experiments/          Task/TaskStep + run_episode + ExperimentRunner + SQLite ExperimentStore
├── evolution/            PromotionGate (statistical) + VersionHistory (rollback)
├── evaluation/           Independent Evaluator (never grades itself)
├── safety/               SafetyGuard: protected components, allowlists, rate limits, audit log
├── telemetry/            Structured tracing with secret redaction
├── self_improvement/     The orchestrator (loop.py) + experience/root_cause/improvement/transfer/metrics
├── api/                  Flask dashboard + JSON API
└── cli/                  argparse-based `acbe` command
```

## Why a mock "sandbox browser" backend is central, not a test-only shim

Section 3 explicitly lists a sandbox browser as one of the intended
backends, and Sections 7/12 require every candidate strategy to be
validated in a sandbox/replay stage before it touches a real environment.
`MockBrowserAdapter` (`acbe/browser/mock_adapter.py`) is that backend: a
small, deterministic, in-memory environment simulator with injectable
failure modes (ambiguous "trap" elements, dynamic/not-yet-interactive
elements, required action sequences, precondition-gated elements,
interstitial popups, broken links, and a verification-method mismatch). It
is used both by the test suite and by `ACBE-Bench`.

## Agent-driven vs. scripted execution

Two ways to produce an episode, unified by a common `EpisodeResult` shape:

* **Scripted** (`acbe.experiments.runner.run_episode`): replays a fixed
  `Task.steps` list. Used for controlled A/B experiments, where the same
  target descriptions must be replayed with different locator strategies.
* **Agent-driven** (`acbe.core.executor.run_agent_episode`): calls a real
  `AgentAdapter.plan()` each step. Used for `ACBE.run("free text goal")`.

Every action an agent-driven run takes is recorded, so a failed free-text
run can still be handed to the self-improvement loop: `build_replay_task`
turns the recorded action sequence back into a `Task`, which the sandbox
can then replay with alternative locator strategies exactly as if it had
been a scripted benchmark task all along. See `acbe/core/executor.py`.
