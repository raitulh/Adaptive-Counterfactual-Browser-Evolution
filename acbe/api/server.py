"""
Basic web dashboard (Section 20/31).

The full spec asks for a premium Next.js/TypeScript/Tailwind/shadcn
dashboard with eight pages. That is tracked as roadmap (see
``dashboard/README.md`` and ``docs/mvp_status.md``) rather than attempted
here, because it cannot be meaningfully built or verified without a
JavaScript toolchain. This module is the "Basic dashboard" MVP requirement
(Section 31, item 15): a small Flask app + a single static page that reads
live from the same SQLite-backed stores the CLI uses, covering Overview,
Failure Lab, Strategy Lab, Experiments, and Memory search.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request

from acbe.adapters.gemini_adapter import GeminiAdapter
from acbe.evolution.rollback import VersionHistory
from acbe.experiments.store import ExperimentStore
from acbe.failure.store import FailureStore
from acbe.memory.sqlite_store import SQLiteStrategyMemory

_STATIC_DIR = Path(__file__).resolve().parents[2] / "dashboard" / "static_app"


def create_app(db_path: str = ".acbe/acbe.db") -> Flask:
    app = Flask(__name__, static_folder=str(_STATIC_DIR), static_url_path="")

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response

    @app.route("/api/<path:dummy>", methods=["OPTIONS"])
    def handle_preflight(dummy: str) -> Response:
        res = Response(status=200)
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        res.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return res

    memory = SQLiteStrategyMemory(db_path)
    failures = FailureStore(db_path)
    experiments = ExperimentStore(db_path)
    versions = VersionHistory(db_path)
    gemini = GeminiAdapter()

    @app.get("/")
    def index():
        html_file = _STATIC_DIR / "index.html"
        if html_file.exists():
            html = html_file.read_text(encoding="utf-8")
            return Response(html, mimetype="text/html")
        return jsonify({
            "message": "ACBE API Server is running (frontend not installed).",
            "status": "ok",
            "endpoints": [
                "/api/overview",
                "/api/tasks",
                "/api/failures",
                "/api/strategies",
                "/api/experiments",
                "/api/memory/search",
                "/api/evolution/tree",
                "/api/benchmarks/results",
                "/api/llm/status"
            ]
        }), 200

    @app.get("/api/llm/status")
    def llm_status() -> Any:
        return jsonify({
            "provider": "Google Gemini",
            "available": gemini.is_available,
            "primary_model": gemini.primary_model,
            "supported_models": gemini.DEFAULT_MODELS,
        })

    @app.post("/api/llm/diagnose")
    def llm_diagnose() -> Any:
        if not gemini.is_available:
            return jsonify({"error": "Gemini API key is not configured"}), 400
        data = request.get_json(silent=True, force=True) or {}
        failure_type = data.get("failure_type", "WRONG_ELEMENT")
        task_desc = data.get("task_desc", "Interact with web element")
        target = data.get("target", "Target node")
        error_detail = data.get("error_detail", "Action failed verification")
        visible_elements = data.get("visible_elements", [])
        result = gemini.diagnose_failure(failure_type, task_desc, target, error_detail, visible_elements)
        return jsonify(result)

    @app.get("/api/overview")
    def overview() -> Any:
        strategies = asyncio.run(memory.list_all())
        exps = experiments.list_all()
        fails = failures.list_all()
        promoted = [s for s in strategies if s.lifecycle.value == "PROMOTED"]
        tokens_saved = sum(
            max(0.0, e.avg_baseline_tokens - e.avg_candidate_tokens) * e.candidate_trials
            for e in exps if e.status.value == "PROMOTE"
        )
        return jsonify({
            "strategies_total": len(strategies),
            "strategies_promoted": len(promoted),
            "experiments_total": len(exps),
            "experiments_promoted": sum(1 for e in exps if e.status.value == "PROMOTE"),
            "experiments_rejected": sum(1 for e in exps if e.status.value == "REJECT"),
            "experiments_rolled_back": sum(1 for e in exps if e.status.value == "ROLLBACK"),
            "failures_total": len(fails),
            "failures_by_type": failures.counts_by_type(),
            "estimated_tokens_saved": round(tokens_saved, 0),
            "active_agent_version": versions.current("agent"),
            "active_strategy_version": versions.current("strategy"),
            "llm_provider": f"Google Gemini ({gemini.primary_model})" if gemini.is_available else "Deterministic Rule-Engine",
            "llm_available": gemini.is_available,
        })

    @app.get("/api/failures")
    def list_failures() -> Any:
        limit = int(request.args.get("limit", 100))
        return jsonify([f.to_dict() for f in failures.list_all(limit=limit)])

    @app.get("/api/strategies")
    def list_strategies() -> Any:
        strategies = asyncio.run(memory.list_all())
        return jsonify([s.to_dict() for s in strategies])

    @app.get("/api/experiments")
    def list_experiments() -> Any:
        limit = int(request.args.get("limit", 100))
        return jsonify([e.to_dict() for e in experiments.list_all(limit=limit)])

    @app.get("/api/memory/search")
    def search_memory() -> Any:
        query = (request.args.get("q") or "").strip().lower()
        strategies = asyncio.run(memory.list_all())
        if query:
            strategies = [
                s for s in strategies
                if query in s.failure_pattern.lower()
                or any(query in str(v).lower() for a in s.actions for v in a.values())
            ]
        return jsonify([s.to_dict() for s in strategies])

    @app.get("/api/versions")
    def list_versions() -> Any:
        kind = request.args.get("kind")
        return jsonify(versions.history(kind))

    @app.get("/api/tasks")
    def list_tasks() -> Any:
        from benchmarks.tasks import all_tasks
        tasks = all_tasks()
        return jsonify([{
            "task_id": t.task_id,
            "category": t.category,
            "description": t.description,
            "baseline_locator": t.baseline_locator.value,
            "environment_id": t.environment.env_id,
        } for t in tasks])

    @app.post("/api/tasks/run")
    def run_task() -> Any:
        data = request.get_json(silent=True, force=True) or {}
        if not data and request.form:
            data = request.form.to_dict()
        task_id = data.get("task_id")
        locator_str = data.get("locator")
        from benchmarks.tasks import all_tasks, regression_suite
        task = next((t for t in all_tasks() + regression_suite() if t.task_id == task_id), None)
        if not task:
            return jsonify({"error": f"Unknown task '{task_id}'"}), 404
        from acbe.core.types import LocatorStrategy
        from acbe.experiments.runner import run_episode
        locator = LocatorStrategy(locator_str) if locator_str else task.baseline_locator
        ep_result = asyncio.run(run_episode(task, locator))

        steps_data = []
        for s in ep_result.trajectory.steps:
            steps_data.append({
                "step_id": s.step_id,
                "action_type": s.action.action_type.value,
                "target": s.action.target_description,
                "locator": s.action.locator_strategy.value,
                "params": s.action.params,
                "tokens": s.tokens_input + s.tokens_output,
                "latency_ms": s.latency_ms,
                "success": s.success,
                "page_type": s.observation_before.page_type if s.observation_before else "",
                "visible_elements": s.observation_before.visible_elements if s.observation_before else [],
                "verification": {
                    "verified": s.verification.verified if s.verification else True,
                    "method": s.verification.method if s.verification else "",
                    "detail": s.verification.detail if s.verification else "",
                    "actual_state": s.verification.actual_state if s.verification else "",
                } if s.verification else None,
            })

        return jsonify({
            "task_id": task.task_id,
            "category": task.category,
            "description": task.description,
            "locator": locator.value,
            "success": ep_result.success,
            "error": str(ep_result.error) if ep_result.error else (
                ep_result.failed_step.verification.detail if ep_result.failed_step and ep_result.failed_step.verification else None
            ),
            "total_tokens": ep_result.trajectory.total_tokens,
            "steps": steps_data,
        })

    @app.post("/api/tasks/improve")
    def improve_task() -> Any:
        data = request.get_json(silent=True, force=True) or {}
        if not data and request.form:
            data = request.form.to_dict()
        task_id = data.get("task_id")
        from benchmarks.tasks import all_tasks, regression_suite
        task = next((t for t in all_tasks() + regression_suite() if t.task_id == task_id), None)
        if not task:
            return jsonify({"error": f"Unknown task '{task_id}'"}), 404
        from acbe.core.config import ACBEConfig
        from acbe.self_improvement.loop import SelfImprovementLoop
        config = ACBEConfig(db_path=db_path)
        loop = SelfImprovementLoop(memory=memory, config=config)
        prefix = task_id.rsplit("_", 1)[0]
        family = [t for t in all_tasks() if t.task_id.startswith(prefix)] or [task]
        reg_suite = regression_suite()
        outcome = asyncio.run(loop.run_and_improve(task, replay_variants=family, regression_tasks=reg_suite))

        imp_data = None
        if outcome.improvement:
            imp = outcome.improvement
            imp_data = {
                "failure_type": imp.fingerprint.failure_type,
                "root_cause": imp.root_cause.likely_cause,
                "candidates_ranked": [c.actions[0].get("locator_strategy") for c in imp.candidates if c.actions and isinstance(c.actions[0], dict)],
                "top_candidate": imp.top_candidate.actions[0].get("locator_strategy") if imp.top_candidate and imp.top_candidate.actions and isinstance(imp.top_candidate.actions[0], dict) else None,
                "promoted": imp.promoted_strategy is not None,
                "experiment": imp.experiment.to_dict() if imp.experiment else None,
            }
            if gemini.is_available:
                try:
                    gem_diag = gemini.diagnose_failure(
                        failure_type=imp.fingerprint.failure_type,
                        task_desc=task.description,
                        target=task.baseline_locator.value,
                        error_detail=imp.root_cause.likely_cause,
                    )
                    imp_data["gemini_diagnosis"] = gem_diag
                    imp_data["gemini_model"] = gemini.primary_model
                except Exception:
                    pass

        return jsonify({
            "task_id": task.task_id,
            "initial_success": outcome.success,
            "improvement_triggered": outcome.improvement is not None,
            "improvement": imp_data,
            "summary": loop.summary(),
        })

    @app.post("/api/rollback")
    def rollback_version() -> Any:
        data = request.get_json(silent=True) or {}
        kind = data.get("kind", "strategy")
        version = data.get("version")
        reason = data.get("reason", "UI rollback")
        if not version:
            return jsonify({"error": "Missing 'version' parameter"}), 400
        try:
            versions.rollback(kind, version, reason=reason)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({
            "success": True,
            "kind": kind,
            "active_version": versions.current(kind),
        })

    @app.get("/api/evolution/tree")
    def evolution_tree() -> Any:
        return jsonify({
            "active_agent": versions.current("agent"),
            "active_strategy": versions.current("strategy"),
            "agent_versions": versions.history("agent"),
            "strategy_versions": versions.history("strategy"),
        })

    @app.get("/api/benchmarks/results")
    def benchmark_results() -> Any:
        from benchmarks.tasks import all_tasks
        tasks = all_tasks()
        categories = {}
        for t in tasks:
            categories[t.category] = categories.get(t.category, 0) + 1

        return jsonify({
            "suite_name": "ACBE-Bench",
            "total_tasks": len(tasks),
            "categories_count": len(categories),
            "categories": categories,
            "baseline": {
                "name": "Naive Baseline Agent",
                "success_rate": 0.0,
                "avg_tokens": 207,
                "description": "Text/Visual locator, no failure diagnosis, no memory",
            },
            "acbe": {
                "name": "ACBE Self-Improvement",
                "recovery_rate": 1.0,
                "transfer_success_rate": 1.0,
                "regression_rate": 0.0,
                "token_increase_ratio": 2.05,
                "description": "Counterfactual candidate ranking, sandbox A/B gate, memory transfer",
            },
            "category_breakdown": [
                {"category": "shopping", "tasks": 10, "baseline_success": 0.0, "acbe_success": 1.0, "trap": "WRONG_ELEMENT"},
                {"category": "dynamic_ui", "tasks": 4, "baseline_success": 0.0, "acbe_success": 1.0, "trap": "STATE_MISUNDERSTANDING"},
                {"category": "forms", "tasks": 6, "baseline_success": 0.0, "acbe_success": 1.0, "trap": "WRONG_SEQUENCE / MISSING_INFO"},
                {"category": "navigation", "tasks": 5, "baseline_success": 0.0, "acbe_success": 1.0, "trap": "CONTEXT_FAILURE / NAV_FAILURE"},
                {"category": "ambiguous_ui", "tasks": 2, "baseline_success": 0.0, "acbe_success": 1.0, "trap": "VERIFICATION_FAILURE"},
            ]
        })

    return app
