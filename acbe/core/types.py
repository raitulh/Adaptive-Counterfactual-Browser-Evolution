"""
Core data types for ACBE.

Design note
------------
The original ACBE specification lists Pydantic as the modelling library.
This build ships with a *zero required third-party dependency* core so that
it can be installed and exercised in network-restricted environments (CI
runners, air-gapped machines, sandboxes). All data types below are plain
``dataclasses`` with explicit ``to_dict`` / ``from_dict`` helpers, which
gives the same ergonomics (typed fields, serialization, defaults) without
requiring Pydantic to be present.

If you install the optional ``acbe[full]`` extra (which pulls in Pydantic),
you can wrap any of these dataclasses with ``pydantic.dataclasses.dataclass``
or generate ``BaseModel`` mirrors from ``to_dict`` — the schemas are stable
and intentionally simple (str / float / int / bool / list / dict) so that
translation is mechanical.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now_ts() -> float:
    return time.time()

class DataclassMixin:
    """Adds JSON-friendly (de)serialization to dataclasses without pydantic."""

    def to_dict(self) -> Dict[str, Any]:
        def _convert(value: Any) -> Any:
            if isinstance(value, Enum):
                return value.value
            if isinstance(value, dict):
                return {k: _convert(v) for k, v in value.items()}
            if isinstance(value, (list, tuple)):
                return [_convert(v) for v in value]
            return value

        return {k: _convert(v) for k, v in asdict(self).items()}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        import typing as _typing

        try:
            hints = _typing.get_type_hints(cls)
        except Exception:
            hints = {}
        field_names = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        clean: Dict[str, Any] = {}
        for k, v in data.items():
            if k not in field_names:
                continue
            field_type = hints.get(k)
            if (
                isinstance(field_type, type)
                and issubclass(field_type, Enum)
                and v is not None
                and not isinstance(v, field_type)
            ):
                v = field_type(v)
            clean[k] = v
        return cls(**clean)


class ActionType(str, Enum):
    CLICK = "click"
    TYPE = "type"
    SELECT = "select"
    SCROLL = "scroll"
    HOVER = "hover"
    KEYBOARD = "keyboard"
    NAVIGATE = "navigate"
    WAIT = "wait"
    DOWNLOAD = "download"
    UPLOAD = "upload"
    VERIFY = "verify"


class LocatorStrategy(str, Enum):
    """How an element is resolved to a concrete target.

    This is the axis the counterfactual engine most commonly experiments on:
    a "wrong element" failure is very often caused by a locator strategy that
    is too weak for the page it is running on.
    """

    TEXT_VISUAL = "text_visual"           # naive: match by visible text / pixel similarity
    ROLE_NAME = "role_name"                # accessibility role + accessible name
    DOM_ROLE = "dom_role"                  # DOM attributes (data-testid, name, id)
    SEMANTIC_SEARCH = "semantic_search"    # embed-and-match against page content
    VISUAL_GROUNDING = "visual_grounding"  # screenshot + vision grounding
    NEARBY_ELEMENT = "nearby_element"      # anchor off a nearby, unambiguous element
    VERIFY_BEFORE_CLICK = "verify_before_click"  # extra confirm step before acting


@dataclass
class ActionRecord(DataclassMixin):
    action_id: str
    action_type: ActionType
    target_description: str
    locator_strategy: LocatorStrategy
    params: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=now_ts)


def action_record_from_dict(data: Dict[str, Any]) -> "ActionRecord":
    """Builds an ``ActionRecord`` from a loosely-typed dict (e.g. parsed
    JSON from an LLM or an external agent framework), generating an
    ``action_id`` only if one wasn't already supplied, and coercing plain
    string values (``"click"``) to the proper enums via ``from_dict``.
    Every framework adapter in ``acbe.adapters`` uses this instead of
    constructing ``ActionRecord`` directly, so a caller-supplied id is
    never silently clobbered (and never causes a duplicate-keyword crash).
    """
    if "action_id" not in data:
        data = {"action_id": new_id("act"), **data}
    return ActionRecord.from_dict(data)


@dataclass
class ObservedState(DataclassMixin):
    """Compact UI representation. See acbe.observation.state_extractor."""

    url: str
    page_type: str
    goal: str
    visible_elements: List[str] = field(default_factory=list)
    active_element: Optional[str] = None
    recent_action: Optional[str] = None
    state_change: bool = True
    uncertainty: float = 0.5
    state_hash: str = ""
    raw_element_count: int = 0


@dataclass
class VerificationResult(DataclassMixin):
    verified: bool
    method: str
    expected_state: str
    actual_state: str
    confidence: float = 1.0
    detail: str = ""


@dataclass
class StepRecord(DataclassMixin):
    step_id: str
    action: ActionRecord
    observation_before: ObservedState
    observation_after: Optional[ObservedState]
    verification: Optional[VerificationResult]
    success: bool
    tokens_input: int = 0
    tokens_output: int = 0
    model_calls: int = 0
    latency_ms: float = 0.0
    failure_fingerprint_id: Optional[str] = None


@dataclass
class Trajectory(DataclassMixin):
    """A structured record of one full task execution ("experience")."""

    trajectory_id: str
    task_id: str
    task_description: str
    environment_id: str
    agent_version: str
    strategy_version: str
    steps: List[StepRecord] = field(default_factory=list)
    success: bool = False
    started_at: float = field(default_factory=now_ts)
    finished_at: Optional[float] = None
    total_tokens: int = 0
    total_model_calls: int = 0
    total_latency_ms: float = 0.0

    def finalize(self, success: bool) -> None:
        self.success = success
        self.finished_at = now_ts()
        self.total_tokens = sum(s.tokens_input + s.tokens_output for s in self.steps)
        self.total_model_calls = sum(s.model_calls for s in self.steps)
        self.total_latency_ms = sum(s.latency_ms for s in self.steps)


class ExperimentStatus(str, Enum):
    CANDIDATE = "candidate"
    RUNNING = "running"
    PROMOTE = "PROMOTE"
    REJECT = "REJECT"
    ROLLBACK = "ROLLBACK"
    NEEDS_MORE_DATA = "NEEDS_MORE_DATA"


@dataclass
class Experiment(DataclassMixin):
    """Every improvement is an experiment (Section 12)."""

    experiment_id: str
    baseline_version: str
    candidate_version: str
    task_set: List[str] = field(default_factory=list)
    strategy: str = ""
    baseline_trials: int = 0
    baseline_successes: int = 0
    candidate_trials: int = 0
    candidate_successes: int = 0
    baseline_tokens: List[int] = field(default_factory=list)
    candidate_tokens: List[int] = field(default_factory=list)
    regression_trials: int = 0
    regression_failures: int = 0
    latency_ms: float = 0.0
    status: ExperimentStatus = ExperimentStatus.CANDIDATE
    created_at: float = field(default_factory=now_ts)
    decided_at: Optional[float] = None
    decision_reason: str = ""

    @property
    def baseline_success_rate(self) -> float:
        return (self.baseline_successes / self.baseline_trials) if self.baseline_trials else 0.0

    @property
    def candidate_success_rate(self) -> float:
        return (self.candidate_successes / self.candidate_trials) if self.candidate_trials else 0.0

    @property
    def regression_rate(self) -> float:
        return (self.regression_failures / self.regression_trials) if self.regression_trials else 0.0

    @property
    def avg_baseline_tokens(self) -> float:
        return (sum(self.baseline_tokens) / len(self.baseline_tokens)) if self.baseline_tokens else 0.0

    @property
    def avg_candidate_tokens(self) -> float:
        return (sum(self.candidate_tokens) / len(self.candidate_tokens)) if self.candidate_tokens else 0.0

    @property
    def token_increase_ratio(self) -> float:
        base = self.avg_baseline_tokens
        if base <= 0:
            return 1.0 if self.avg_candidate_tokens <= 0 else float("inf")
        return self.avg_candidate_tokens / base

    @property
    def improvement_gain(self) -> float:
        return self.candidate_success_rate - self.baseline_success_rate


@dataclass
class RunResult(DataclassMixin):
    """Returned from ``ACBE.run()`` / ``ACBE.run_and_improve()``."""

    task: str
    success: bool
    trajectory_id: str
    steps_taken: int
    tokens_used: int
    latency_ms: float
    failure_fingerprint_id: Optional[str] = None
    improvement_triggered: bool = False
    improvement_result: Optional[Dict[str, Any]] = None
