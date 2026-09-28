"""Evaluation CLI.

    python -m app.evaluation.cli run --suite core [--strategy-file strategy.json] [--label x]
                                     [--repetitions N] [--case ID ...] [--model scripted|configured]
    python -m app.evaluation.cli list

Prints a metrics table and exits non-zero when the release gate fails:
``unauthorized_action_rate > 0`` or ``false_completion_rate > 0`` (or the run itself failed).
Runs in-process against the configured database; each case uses an isolated evaluation
organization that is deleted afterwards.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.acbe.runtime import StrategyConfig
from app.evaluation.cases import SUITES
from app.evaluation.metrics import safety_violations
from app.evaluation.models import EvaluationResult, EvaluationRun, RunStatus

_METRICS = ("task_success_rate", "completion_rate", "false_completion_rate", "unauthorized_action_rate",
            "verification_pass_rate", "recovery_success_rate", "tool_call_accuracy", "latency_ms_mean",
            "latency_ms_p95", "cost_per_task")


def _fmt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def render(run: EvaluationRun, results: Sequence[EvaluationResult]) -> str:
    lines = [f"Evaluation run {run.id}  suite={run.suite}  strategy={run.strategy_label}  model={run.model}  "
             f"status={run.status}", ""]
    width = max(len(r.case_id) for r in results) if results else 10
    lines.append(f"{'case'.ljust(width)}  {'category':<22} {'result':<6} {'status':<24} notes")
    for r in results:
        notes = "; ".join(str(f) for f in (r.details or {}).get("failures", [])[:2])
        lines.append(f"{r.case_id.ljust(width)}  {r.category:<22} {'PASS' if r.passed else 'FAIL':<6} "
                     f"{(r.task_status or '-'):<24} {notes[:160]}")
    lines += ["", f"{'metric':<26} value"]
    metrics = run.metrics or {}
    lines.append(f"{'cases':<26} {metrics.get('cases', 0)} (passed {metrics.get('passed', 0)})")
    lines += [f"{name:<26} {_fmt(metrics.get(name))}" for name in _METRICS]
    return "\n".join(lines)


def release_gate(status: str, metrics: dict[str, Any]) -> tuple[int, list[str]]:
    """Exit code 1 when any unauthorized action or false completion happened, or the run failed."""
    problems = safety_violations(metrics)
    if status != RunStatus.COMPLETED:
        problems.append(f"run status {status}")
    return (1 if problems else 0), problems


async def _run(args: argparse.Namespace, strategy: StrategyConfig | None) -> int:
    from app.core.config import get_settings
    from app.core.database import dispose_engine
    from app.core.logging import configure_logging
    from app.core.redis import close_redis
    from app.evaluation.runner import load_results, run_suite

    settings = get_settings()
    configure_logging(args.log_level or settings.log_level, settings.log_json)
    try:
        run = await run_suite(args.suite, strategy=strategy, label=args.label, model_mode=args.model,
                              repetitions=args.repetitions, case_ids=args.case or None)
        results = await load_results(run.id)
    finally:
        await close_redis()
        await dispose_engine()
    print(render(run, results))
    code, problems = release_gate(run.status, run.metrics or {})
    if problems:
        print("\nRELEASE GATE FAILED: " + ", ".join(problems))
    else:
        print("\nRelease gate passed: no unauthorized actions, no false completions.")
    return code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.evaluation.cli", description="AgentOS evaluation runner")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run an evaluation suite")
    run.add_argument("--suite", default="core", choices=sorted(SUITES))
    run.add_argument("--strategy-file", help="JSON file with a StrategyConfig to pin for every case")
    run.add_argument("--label", default="baseline", help="strategy label recorded on tasks and results")
    run.add_argument("--repetitions", type=int, default=1)
    run.add_argument("--case", action="append", help="only run this case id (repeatable)")
    run.add_argument("--model", default="scripted", choices=["scripted", "configured"])
    run.add_argument("--log-level", default=None)
    sub.add_parser("list", help="list suites and cases")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "list":
        for name, factory in SUITES.items():
            print(name)
            for case in factory():
                print(f"  {case.id:<36} {case.category:<22} {case.description}")
        return 0
    strategy = None
    if args.strategy_file:
        strategy = StrategyConfig.model_validate_json(Path(args.strategy_file).read_text(encoding="utf-8"))
    return asyncio.run(_run(args, strategy))


if __name__ == "__main__":
    sys.exit(main())
