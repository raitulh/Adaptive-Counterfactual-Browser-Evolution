# MVP Status

This build targets Section 31's MVP list plus the self-improvement update's
requirement that the self-improvement loop be the central architecture, not
a side feature. It does not attempt the full 32-section spec at production
scale in one pass -- below is an honest map of what's real and tested vs.
what's scaffolded or roadmap, including two build-environment constraints
that shaped some implementation choices.

## Build-environment constraints (and how they were handled)

This project was built and tested in a sandboxed environment with **no
package-registry network access** (`pip`/`npm` installs to PyPI/npm both
fail with `host_not_allowed`). Two consequences, handled explicitly rather
than silently:

1. **Core dependency list.** Section 19 specifies Pydantic, FastAPI, Typer,
   Rich, httpx, and pytest. None could be installed and verified here, so
   the core (`acbe/`) is implemented with the standard library instead
   (`dataclasses`, `argparse`, `sqlite3`, `asyncio`, `unittest`) plus
   whatever was already present in the environment (`Flask`, `requests`,
   `Playwright`). This is a genuine, deliberate design choice, not just a
   workaround: the core has **zero required third-party dependencies**,
   and the "richer" stack can be layered in as an optional extra (see
   `pyproject.toml`) in a normal environment with registry access, where
   none of these constraints apply.
2. **Dashboard/frontend.** Section 20 specifies a Next.js/TypeScript/
   Tailwind/shadcn dashboard. Without npm registry access it could not be
   built and verified, so a Flask + vanilla-JS "basic dashboard" ships
   instead (see `dashboard/README.md`), and the landing page is static
   HTML/CSS/JS (which needed no package manager at all and is fully
   verifiable).

## Section-by-section status

| Section | Status | Notes |
|---|---|---|
| 1. Core loop | ✅ Implemented & tested | `acbe/self_improvement/loop.py`; execution/evaluation/diagnosis/improvement/experimentation/promotion kept as distinct phases. |
| 2. Universal agent integration | ✅ / 🚧 | Custom Python agents: real. Ollama/OpenAI-compatible: real HTTP clients (unit-tested with mocked responses). LangGraph/LangChain/CrewAI/MCP: real adapter code, but soft-dependency and not exercised by the test suite (would need those packages installed). |
| 3. Browser/computer-use engine | ✅ / 🚧 | `MockBrowserAdapter` (sandbox): fully implemented and the basis of all tests. `PlaywrightBrowserAdapter`: real implementation, unit-tested with mocked Playwright objects; not run against a live browser here (no browser binaries in this sandbox -- works in a normal environment after `playwright install chromium`). |
| 4. Compact UI state | ✅ Implemented & tested | `acbe/observation/state_extractor.py`, including state hashing and dedup. |
| 5. Failure fingerprint system | ✅ Implemented & tested | All 13 taxonomy categories defined; 8 have concrete, executable synthetic scenarios (see `tests/test_synthetic_failures.py`). The remaining 5 (`WRONG_ACTION`, `PLANNING_FAILURE`, `REASONING_FAILURE`, `TOKEN_BUDGET_FAILURE`, and general `TOOL_FAILURE`) are agent/model-level categories rather than environment-level ones and are exercised structurally, not via a dedicated synthetic environment. |
| 6. Counterfactual strategy engine | ✅ Implemented & tested | Generates 2-6 structurally distinct candidates per failure type. |
| 7. Cheap strategy competition | ✅ Implemented & tested | Deterministic filter -> cheap score -> small-model-scorer funnel, configurable sizes. The heuristic itself is static, not learned -- see `research/methodology.md`. |
| 8. Token optimization engine | ✅ Implemented & tested | `TokenTracker`, `ModelRouter` with the deterministic/small/large tiering and adaptive observation depth. |
| 9. Strategy memory | ✅ Implemented & tested | SQLite-backed; abstract `StrategyMemory` interface so Postgres/Qdrant/OpenSearch can be added later without touching callers. |
| 10. Cross-task strategy transfer | ✅ Implemented & tested | `CrossTaskTransfer`; transfer confidence never assumed at 100% for an unseen environment. |
| 11. Safe self-improvement | ✅ / 🚧 | Levels 1-2 (strategy, ranking) implemented. Level 3 (controlled code evolution) has the safety scaffolding (`SafetyGuard.check_protected_component`) but no actual code-mutation pipeline -- flagged as future work rather than half-built. |
| 12. Experiment engine | ✅ Implemented & tested | A/B testing, regression suite, sandbox/replay. |
| 13. Promotion system | ✅ Implemented & tested | Statistical (two-proportion z-test), sample-size, regression, and token-cost gates all independently testable. |
| 14. Rollback | ✅ Implemented & tested | Versioned, with `acbe rollback` / `acbe history` / `acbe compare`. |
| 15. Evaluation engine | ✅ Implemented & tested | Deterministic evaluators; `llm_judge` is a pluggable fallback hook, not wired to a live model here. |
| 16. ACBE-Bench | ✅ / 🚧 | 27 synthetic tasks across 7 categories (target was 30-50; this is an honest starter set, see `benchmarks/tasks.py`). BrowserGym/WebArena/VisualWebArena/OSWorld integration is roadmap. |
| 17. Benchmark metrics | ✅ Implemented & tested | Including `Success Rate / Token Cost` and `Improvement Efficiency`. |
| 18. Baselines + prior art | ✅ | `research/prior_art.md`; `benchmarks/run_benchmark.py` implements the "Baseline Agent" vs "Full ACBE" comparison explicitly (not all seven Section 18 baseline variants are separately wired up yet). |
| 19. Technology stack | 🚧 Adapted | See "Build-environment constraints" above. |
| 20. Dashboard | ✅ / 🚧 | Basic Flask dashboard covers 5 of 8 pages. See `dashboard/README.md`. |
| 21-22. Landing page | ✅ Implemented | Static HTML/CSS/JS in `landing/index.html`, matching the specified copy and section structure. |
| 23. Developer CLI | ✅ Implemented & tested | All 15 listed commands, argparse-based. |
| 24. Project structure | ✅ Matches spec | See top-level layout. |
| 25. API design | ✅ Implemented | `AgentAdapter`, `BrowserAdapter`, `FailureAnalyzer`-equivalent (`FailureFingerprintBuilder` + `RootCauseAnalyzer`), `StrategyGenerator` (`CounterfactualGenerator`), `StrategyEvaluator` (ranking), `StrategyMemory`, `ExperimentRunner`, `PromotionGate` -- all present with the spec's method names or direct equivalents. |
| 26. Observability | ✅ Implemented & tested | Structured trace events, JSON export, secret redaction. |
| 27. Security | ✅ Implemented & tested | Protected components, destructive-action confirmation, domain allowlist, rate limiting, audit log. |
| 28. Testing | ✅ | `unittest`-based (not `pytest`, for the same reason as Section 19); synthetic failures for all 8 concrete categories. |
| 29. Reproducibility | ✅ / 🚧 | Experiments record model/version/task-set/seed-relevant fields; `acbe experiment reproduce <id>` re-displays and (where the task family is known) re-runs. Full determinism across arbitrary real-environment runs is out of scope for a browser-based system in general. |
| 30-32. Research positioning / MVP / roadmap | ✅ | This document, plus `research/`. |

## Definition of "done" used above

✅ = implemented **and** covered by a passing automated test in this
repository. 🚧 = partially implemented, or implemented but not (yet) proven
by a test in this repository. Nothing in this table is marked done based on
code existing alone.
