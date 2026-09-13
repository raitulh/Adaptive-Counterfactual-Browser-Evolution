"""
Developer CLI (Section 23).

Built with ``argparse`` + plain-text tables rather than Typer/Rich so the
core install has zero required third-party dependencies (see
``acbe/core/types.py`` for the same rationale). Every subcommand from the
spec is implemented; ``acbe init/run/eval/trace/failures/strategies/improve/
experiment/compare/benchmark/history/rollback/serve`` all do real work
against the bundled synthetic benchmark and the SQLite-backed stores.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import List, Optional

from acbe.core.config import ACBEConfig
from acbe.core.types import LocatorStrategy
from acbe.evaluation.evaluator import Evaluator
from acbe.evolution.rollback import VersionHistory, VersionNotFoundError
from acbe.experiments.runner import ExperimentRunner, Task, run_episode
from acbe.experiments.store import ExperimentStore
from acbe.failure.store import FailureStore
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.loop import SelfImprovementLoop
from acbe.telemetry.tracer import Tracer

DEFAULT_DB = ".acbe/acbe.db"


def _find_task(task_id: str) -> Optional[Task]:
    from benchmarks.tasks import all_tasks, regression_suite
    for t in all_tasks() + regression_suite():
        if t.task_id == task_id:
            return t
    return None


def _family_for(task_id: str) -> List[Task]:
    """Best-effort: find the sibling tasks in the same benchmark family, for
    use as replay/A-B variants when improving a specific task."""
    import benchmarks.tasks as bt
    prefix = task_id.rsplit("_", 1)[0]
    return [t for t in bt.all_tasks() if t.task_id.startswith(prefix)]


def cmd_init(args: argparse.Namespace) -> None:
    config = ACBEConfig(db_path=args.db)
    config.ensure_dirs()
    SQLiteStrategyMemory(args.db)
    VersionHistory(args.db)
    Path(args.db).parent.joinpath("config.json").write_text(json.dumps(config.__dict__, default=str, indent=2))
    print(f"Initialized ACBE project at '{Path(args.db).parent}'.")
    print(f"  database: {args.db}")


def cmd_run(args: argparse.Namespace) -> None:
    if args.list:
        from benchmarks.tasks import all_tasks
        for t in all_tasks():
            print(f"{t.task_id:28s} {t.category:22s} {t.description}")
        return
    task = _find_task(args.task_id)
    if task is None:
        print(f"Unknown task '{args.task_id}'. Use --list to see available tasks.", file=sys.stderr)
        sys.exit(1)
    locator = LocatorStrategy(args.locator) if args.locator else task.baseline_locator
    result = asyncio.run(run_episode(task, locator))
    print(f"task:        {task.task_id}")
    print(f"locator:     {locator.value}")
    print(f"success:     {result.success}")
    print(f"steps:       {len(result.trajectory.steps)}")
    print(f"tokens:      {result.trajectory.total_tokens}")
    if not result.success:
        reason = str(result.error) if result.error else (
            result.failed_step.verification.detail if result.failed_step and result.failed_step.verification else "unknown"
        )
        print(f"failure:     {reason}")


def cmd_eval(args: argparse.Namespace) -> None:
    task = _find_task(args.task_id)
    if task is None:
        print(f"Unknown task '{args.task_id}'.", file=sys.stderr)
        sys.exit(1)
    result = asyncio.run(run_episode(task, task.baseline_locator))
    evaluation = Evaluator().evaluate(result.trajectory)
    print(json.dumps(evaluation.to_dict(), indent=2, default=str))


def cmd_trace(args: argparse.Namespace) -> None:
    task = _find_task(args.task_id)
    if task is None:
        print(f"Unknown task '{args.task_id}'.", file=sys.stderr)
        sys.exit(1)
    tracer = Tracer(trace_dir=str(Path(args.db).parent / "traces"))
    result = asyncio.run(run_episode(task, task.baseline_locator))
    tracer.event(task.task_id, "agent-v1", task.baseline_locator.value,
                 event="cli_trace", success=result.success, tokens=result.trajectory.total_tokens,
                 steps=[s.to_dict() for s in result.trajectory.steps])
    out_path = args.out or str(Path(args.db).parent / "traces" / f"{task.task_id}.json")
    tracer.export_json(out_path)
    print(f"Trace written to {out_path}")


def cmd_failures(args: argparse.Namespace) -> None:
    store = FailureStore(args.db)
    failures = store.list_all(limit=args.limit)
    if not failures:
        print("No recorded failures yet. Run `acbe improve` first.")
        return
    for f in failures:
        print(f"{f.fingerprint_id:16s} {f.failure_type:22s} task={f.task_id:24s} conf={f.confidence:.2f} {f.error[:60]}")


def cmd_strategies(args: argparse.Namespace) -> None:
    memory = SQLiteStrategyMemory(args.db)
    strategies = asyncio.run(memory.list_all())
    if not strategies:
        print("No stored strategies yet. Run `acbe improve` first.")
        return
    for s in strategies:
        locator = s.actions[0].get("locator_strategy", "?") if s.actions else "?"
        print(f"{s.strategy_id:16s} pattern={s.failure_pattern:22s} locator={locator:16s} "
              f"lifecycle={s.lifecycle.value:12s} success_rate={s.success_rate:.2%} trials={s.trials}")


def cmd_improve(args: argparse.Namespace) -> None:
    task_id = args.task_id
    if args.failure == "latest" and not task_id:
        store = FailureStore(args.db)
        recent = store.list_all(limit=1)
        if not recent:
            print("No recorded failures to improve from. Run `acbe run` on a task first.", file=sys.stderr)
            sys.exit(1)
        task_id = recent[0].task_id
        print(f"Using most recent recorded failure: task '{task_id}' ({recent[0].failure_type})")

    task = _find_task(task_id)
    if task is None:
        print(f"Unknown task '{task_id}'.", file=sys.stderr)
        sys.exit(1)

    family = _family_for(task.task_id)
    from benchmarks.tasks import regression_suite
    regression = [t for t in regression_suite() if t.category.endswith("regression")]

    config = ACBEConfig(db_path=args.db, promotion_min_sample_size=min(8, max(2, len(family))),
                         promotion_max_token_increase_ratio=10.0)
    memory = SQLiteStrategyMemory(args.db)
    loop = SelfImprovementLoop(memory=memory, config=config)
    outcome = asyncio.run(loop.run_and_improve(task, replay_variants=family or [task], regression_tasks=regression))

    print(f"task:      {task.task_id}")
    print(f"success:   {outcome.success}")
    if outcome.improvement:
        imp = outcome.improvement
        print(f"failure_type:     {imp.fingerprint.failure_type}")
        print(f"root_cause:       {imp.root_cause.likely_cause}")
        print(f"candidates_ranked:{[c.actions[0].get('locator_strategy') for c in imp.candidates]}")
        print(f"top_candidate:    {imp.top_candidate.actions[0].get('locator_strategy')}")
        print(f"experiment:       {imp.experiment.status.value} -- {imp.experiment.decision_reason}")
        print(f"promoted:         {imp.promoted_strategy is not None}")
    else:
        print("Task succeeded on the first attempt -- nothing to improve.")


def cmd_experiment(args: argparse.Namespace) -> None:
    if args.experiment_command == "list":
        store = ExperimentStore(args.db)
        for e in store.list_all(limit=args.limit):
            print(f"{e.experiment_id:16s} status={e.status.value:16s} strategy={e.strategy:16s} "
                  f"gain={e.improvement_gain:+.3f} tokens_x={e.token_increase_ratio:.2f}")
        return

    if args.experiment_command == "reproduce":
        store = ExperimentStore(args.db)
        exp = store.get(args.experiment_id)
        if exp is None:
            print(f"Unknown experiment '{args.experiment_id}'.", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(exp.to_dict(), indent=2, default=str))
        return

    # experiment run: manually A/B test one locator strategy against the baseline
    task = _find_task(args.task_id)
    if task is None:
        print(f"Unknown task '{args.task_id}'.", file=sys.stderr)
        sys.exit(1)
    family = _family_for(task.task_id) or [task]
    candidate_locator = LocatorStrategy(args.candidate_locator)
    runner = ExperimentRunner()
    experiment = asyncio.run(runner.run(
        experiment_id=f"manual_{task.task_id}", baseline_version="baseline",
        candidate_version=f"candidate-{candidate_locator.value}", strategy_id=candidate_locator.value,
        task_set=family, baseline_locator=task.baseline_locator, candidate_locator=candidate_locator,
    ))
    ExperimentStore(args.db).save(experiment)
    print(f"baseline_success_rate:  {experiment.baseline_success_rate:.2%}")
    print(f"candidate_success_rate: {experiment.candidate_success_rate:.2%}")
    print(f"improvement_gain:       {experiment.improvement_gain:+.3f}")
    print(f"avg_baseline_tokens:    {experiment.avg_baseline_tokens:.0f}")
    print(f"avg_candidate_tokens:   {experiment.avg_candidate_tokens:.0f}")


def cmd_compare(args: argparse.Namespace) -> None:
    history = VersionHistory(args.db)
    try:
        result = history.compare(args.kind, args.v1, args.v2)
    except VersionNotFoundError as exc:
        print(f"Unknown version: {exc}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(result, indent=2, default=str))


def cmd_benchmark(args: argparse.Namespace) -> None:
    from benchmarks.run_benchmark import main as bench_main
    asyncio.run(bench_main())


def cmd_history(args: argparse.Namespace) -> None:
    history = VersionHistory(args.db)
    for entry in history.history(args.kind):
        print(f"{entry['kind']:10s} {entry['version']:24s} parent={entry['parent_version']}")


def cmd_rollback(args: argparse.Namespace) -> None:
    history = VersionHistory(args.db)
    try:
        history.rollback(args.kind, args.version, reason=args.reason or "cli rollback")
    except VersionNotFoundError as exc:
        print(f"Unknown version: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"Rolled back '{args.kind}' to version '{args.version}'.")


def cmd_serve(args: argparse.Namespace) -> None:
    from acbe.api.server import create_app
    app = create_app(args.db)
    print(f"ACBE server: http://{args.host}:{args.port}")
    if getattr(args, "prod", False):
        try:
            import waitress
            print("Serving with Waitress production WSGI server...")
            waitress.serve(app, host=args.host, port=args.port)
            return
        except ImportError:
            print("Waitress not installed; falling back to default server.")
    app.run(host=args.host, port=args.port, debug=False)



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="acbe", description="ACBE -- the self-improvement layer for AI agents.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="Initialize an ACBE project (.acbe/ directory + database).")
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("run", help="Run a single bundled benchmark task.")
    p.add_argument("--task", dest="task_id", default=None)
    p.add_argument("--locator", default=None, choices=[l.value for l in LocatorStrategy])
    p.add_argument("--list", action="store_true", help="List available task ids.")
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("eval", help="Run a task and print its independent evaluation.")
    p.add_argument("--task", dest="task_id", required=True)
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_eval)

    p = sub.add_parser("trace", help="Run a task and export a structured JSON trace.")
    p.add_argument("--task", dest="task_id", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_trace)

    p = sub.add_parser("failures", help="List recorded failure fingerprints.")
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_failures)

    p = sub.add_parser("strategies", help="List strategies in procedural memory.")
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_strategies)

    p = sub.add_parser("improve", help="Run the self-improvement loop on a failing task.")
    p.add_argument("--task", dest="task_id", default=None)
    p.add_argument("--failure", default=None, help="Use 'latest' to improve from the most recent recorded failure.")
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_improve)

    p = sub.add_parser("experiment", help="Run, list, or reproduce experiments.")
    exp_sub = p.add_subparsers(dest="experiment_command", required=True)

    run_p = exp_sub.add_parser("run", help="Manually A/B test one candidate locator strategy.")
    run_p.add_argument("--task", dest="task_id", required=True)
    run_p.add_argument("--candidate-locator", required=True, choices=[l.value for l in LocatorStrategy])
    run_p.add_argument("--db", default=DEFAULT_DB)
    run_p.set_defaults(func=cmd_experiment)

    list_p = exp_sub.add_parser("list", help="List stored experiments.")
    list_p.add_argument("--db", default=DEFAULT_DB)
    list_p.add_argument("--limit", type=int, default=50)
    list_p.set_defaults(func=cmd_experiment)

    repro_p = exp_sub.add_parser("reproduce", help="Print a stored experiment's full parameters.")
    repro_p.add_argument("experiment_id")
    repro_p.add_argument("--db", default=DEFAULT_DB)
    repro_p.set_defaults(func=cmd_experiment)

    p = sub.add_parser("compare", help="Compare two versions of a strategy or agent.")
    p.add_argument("v1")
    p.add_argument("v2")
    p.add_argument("--kind", default="strategy", choices=["strategy", "agent"])
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("benchmark", help="Run ACBE-Bench (baseline vs full ACBE).")
    p.add_argument("--suite", default="acbe-basic")
    p.set_defaults(func=cmd_benchmark)

    p = sub.add_parser("history", help="Show version history.")
    p.add_argument("--kind", default=None, choices=["strategy", "agent"])
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_history)

    p = sub.add_parser("rollback", help="Roll back the active version pointer.")
    p.add_argument("version")
    p.add_argument("--kind", default="strategy", choices=["strategy", "agent"])
    p.add_argument("--reason", default=None)
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(func=cmd_rollback)

    p = sub.add_parser("serve", help="Serve the web API and dashboard.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8420)
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--prod", "--production", action="store_true", dest="prod", help="Run with Waitress production WSGI server.")
    p.set_defaults(func=cmd_serve)

    return parser


def main(argv: Optional[List[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except BrokenPipeError:
        # e.g. `acbe run --list | head` -- not a real error.
        import os
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
        sys.exit(0)


if __name__ == "__main__":
    main()
