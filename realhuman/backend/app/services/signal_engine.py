"""
Signal engine: turns everything known about a challenge submission into the
four public signals of the web app's catalog.

Internally the engine evaluates five factor families and folds them into the
public signals, so the API contract stays stable while the detection logic
evolves:

    behavior    ─┐
    automation  ─┼─► interaction_pattern   (input timing, pointer path, key repeat)
    challenge   ───► challenge_response    (hold length vs. server-side timing)
    session     ─┐
    automation  ─┼─► session_consistency   (same client start→finish, browser coherence)
    rate        ─┐
    network     ─┼─► request_behavior      (request volume, history, IP reputation)

Every factor records its impact and a human-readable note. The most negative
factor becomes the signal's `detail`, and all factors are stored for audit.
Pure functions only: no database, no clock, no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.schemas.common import round_score
from app.schemas.verification import ChallengeResponseIn, SignalId
from app.services.network import NetworkInfo, RequestMeta

FactorFamily = Literal["behavior", "automation", "challenge", "session", "network", "rate"]


@dataclass(frozen=True)
class SignalDefinition:
    label: str
    weight: float


# Must match `src/lib/verification/signals.ts` in the web app.
SIGNAL_CATALOG: dict[SignalId, SignalDefinition] = {
    "interaction_pattern": SignalDefinition("Interaction pattern", 0.3),
    "challenge_response": SignalDefinition("Challenge response", 0.3),
    "session_consistency": SignalDefinition("Session consistency", 0.2),
    "request_behavior": SignalDefinition("Request behavior", 0.2),
}

# Substrings (lower-case) that identify automation frameworks and HTTP libraries.
AUTOMATION_UA_MARKERS = (
    "headlesschrome",
    "phantomjs",
    "puppeteer",
    "playwright",
    "selenium",
    "webdriver",
    "python-requests",
    "python-urllib",
    "aiohttp",
    "httpx",
    "curl/",
    "wget/",
    "go-http-client",
    "node-fetch",
    "undici",
    "axios/",
    "okhttp",
    "java/",
    "libwww-perl",
    "scrapy",
    "bot/",
    "crawler",
    "spider/",
)

# Below this impact a factor is worth reporting as the signal's detail.
_NOTABLE = -0.05


@dataclass(frozen=True)
class Factor:
    family: FactorFamily
    code: str
    impact: float
    note: str

    def as_dict(self) -> dict:
        return {
            "family": self.family,
            "code": self.code,
            "impact": round(self.impact, 3),
            "note": self.note,
        }


@dataclass(frozen=True)
class SignalEvaluation:
    id: SignalId
    score: float
    detail: str
    factors: tuple[Factor, ...] = field(default_factory=tuple)

    @property
    def label(self) -> str:
        return SIGNAL_CATALOG[self.id].label

    @property
    def weight(self) -> float:
        return SIGNAL_CATALOG[self.id].weight


@dataclass(frozen=True)
class ClientFingerprint:
    """Keyed hashes of client identifiers plus the (non-identifying) origin host."""

    ip_hash: str | None
    ua_hash: str | None
    lang_hash: str | None
    origin: str


@dataclass(frozen=True)
class RateStats:
    sessions_from_ip_10m: int = 1
    challenges_from_ip_10m: int = 1
    blocked_from_ip_1h: int = 0


@dataclass(frozen=True)
class SignalContext:
    response: ChallengeResponseIn
    session_age_ms: int
    prior_attempts: int
    started: ClientFingerprint
    current: ClientFingerprint
    meta: RequestMeta
    network: NetworkInfo
    rates: RateStats
    hold_required_ms: int = 1100


def evaluate_signals(ctx: SignalContext) -> list[SignalEvaluation]:
    """Evaluates all four signals, in catalog order."""
    return [
        interaction_pattern(ctx),
        challenge_response(ctx),
        session_consistency(ctx),
        request_behavior(ctx),
    ]


def _finish(signal_id: SignalId, base: float, factors: list[Factor], fallback: str):
    score = round_score(max(0.02, min(0.99, base + sum(f.impact for f in factors))))
    worst = min(factors, key=lambda f: f.impact, default=None)
    detail = worst.note if worst is not None and worst.impact <= _NOTABLE else fallback
    return SignalEvaluation(signal_id, score, detail, tuple(factors))


# ── interaction_pattern ─────────────────────────────────────────────────────


def interaction_pattern(ctx: SignalContext) -> SignalEvaluation:
    response, t = ctx.response, ctx.response.telemetry
    if t is None:
        return SignalEvaluation(
            "interaction_pattern",
            0.6,
            "No interaction telemetry was supplied.",
            (Factor("behavior", "telemetry_missing", -0.35, "No interaction telemetry."),),
        )

    factors: list[Factor] = []
    add = factors.append

    if t.untrusted_events:
        add(
            Factor(
                "automation",
                "untrusted_events",
                -0.6,
                "Synthetic (script-generated) input events were detected.",
            )
        )

    ttfi = t.time_to_first_input_ms
    if ttfi is not None:
        if ttfi < 120:
            add(
                Factor(
                    "behavior",
                    "instant_input",
                    -0.35,
                    "Input began faster than human reaction time.",
                )
            )
        elif ttfi < 250:
            add(Factor("behavior", "fast_input", -0.12, "Input began unusually quickly."))

    if t.early_releases is not None and t.early_releases > 10:
        add(Factor("behavior", "many_restarts", -0.1, "The challenge was restarted many times."))

    method = response.input_method
    if response.type == "single_step":
        fallback = "Single-step challenge; interaction was evaluated on timing."
        base = 0.86
    elif method == "keyboard":
        fallback = "Key hold showed natural auto-repeat."
        base = 0.95
        if t.key_repeats is not None and t.key_repeats == 0:
            add(
                Factor(
                    "behavior",
                    "no_key_repeat",
                    -0.12,
                    "No key auto-repeat was observed during the hold.",
                )
            )
    else:
        base = 0.95
        pointer_type = t.pointer_type
        if pointer_type is not None and (pointer_type == "touch") != (method == "touch"):
            add(
                Factor(
                    "automation",
                    "input_mismatch",
                    -0.2,
                    "Reported input method did not match the observed input.",
                )
            )
        if pointer_type == "touch" or method == "touch":
            fallback = "Touch contact varied naturally."
            if t.hold_moves == 0 and not t.hold_jitter_px:
                add(
                    Factor(
                        "behavior",
                        "static_touch",
                        -0.1,
                        "Touch contact showed no natural variation.",
                    )
                )
        else:
            fallback = "Input timing varied naturally during the hold."
            factors.extend(_pointer_path_factors(t.approach_moves, t))

    return _finish("interaction_pattern", base, factors, fallback)


def _pointer_path_factors(moves: int | None, t) -> list[Factor]:
    if moves is None:
        return []
    if moves == 0:
        # Mild: people often press without moving when the control appears under the cursor.
        return [
            Factor(
                "behavior",
                "no_approach",
                -0.12,
                "The pointer reached the control without any movement.",
            )
        ]
    straight = t.approach_straightness
    speed_cv = t.approach_speed_cv
    if moves >= 5 and straight is not None and speed_cv is not None:
        if straight >= 0.995 and speed_cv <= 0.05:
            return [
                Factor(
                    "automation",
                    "linear_path",
                    -0.5,
                    "Pointer path was perfectly straight at constant speed.",
                )
            ]
        if speed_cv < 0.1:
            return [
                Factor("behavior", "uniform_speed", -0.15, "Input timing was unusually uniform.")
            ]
    return []


# ── challenge_response ──────────────────────────────────────────────────────


def challenge_response(ctx: SignalContext) -> SignalEvaluation:
    response = ctx.response
    factors: list[Factor] = []
    add = factors.append
    age = ctx.session_age_ms
    hold = response.hold_duration_ms

    if response.type == "press_hold":
        base, fallback = 0.94, "Challenge completed as issued, within its window."
        if hold < ctx.hold_required_ms - 100:
            add(
                Factor(
                    "challenge",
                    "hold_too_short",
                    -0.75,
                    "The hold ended before the required duration.",
                )
            )
        elif hold > age + 250:
            add(
                Factor(
                    "challenge",
                    "impossible_hold",
                    -0.8,
                    "Reported hold is longer than the session has existed.",
                )
            )
        elif age < hold + 200:
            add(
                Factor(
                    "challenge",
                    "no_reaction_time",
                    -0.25,
                    "The challenge was completed with no time to react.",
                )
            )
        if hold > 30_000:
            add(Factor("challenge", "hold_too_long", -0.2, "The hold lasted unusually long."))
    else:
        base, fallback = 0.86, "Accessible single-step challenge completed within its window."
        if age < 400:
            add(
                Factor(
                    "challenge",
                    "too_fast",
                    -0.3,
                    "Completed faster than the challenge could be read.",
                )
            )

    if ctx.prior_attempts:
        add(
            Factor(
                "challenge",
                "retried",
                -0.04 * ctx.prior_attempts,
                f"Challenge retried {ctx.prior_attempts} time(s).",
            )
        )

    return _finish("challenge_response", base, factors, fallback)


# ── session_consistency ─────────────────────────────────────────────────────


def session_consistency(ctx: SignalContext) -> SignalEvaluation:
    started, current, meta = ctx.started, ctx.current, ctx.meta
    t = ctx.response.telemetry
    factors: list[Factor] = []
    add = factors.append

    if started.ua_hash != current.ua_hash:
        add(
            Factor(
                "session",
                "ua_changed",
                -0.45,
                "The browser changed between session start and challenge.",
            )
        )
    if started.ip_hash != current.ip_hash:
        add(Factor("session", "ip_changed", -0.15, "The network address changed mid-session."))
    if started.lang_hash and current.lang_hash and started.lang_hash != current.lang_hash:
        add(Factor("session", "lang_changed", -0.1, "Browser language changed mid-session."))
    if started.origin != current.origin:
        add(
            Factor(
                "session",
                "origin_changed",
                -0.3,
                "The challenge came from a different site than the session.",
            )
        )

    ua = meta.user_agent.lower()
    if not ua:
        add(Factor("automation", "no_user_agent", -0.4, "No user agent was sent."))
    elif any(marker in ua for marker in AUTOMATION_UA_MARKERS):
        add(
            Factor(
                "automation",
                "automation_user_agent",
                -0.5,
                "User agent identifies an automated client.",
            )
        )
    if meta.accept_language is None:
        add(Factor("automation", "no_language", -0.15, "No browser language was sent."))
    if meta.sec_fetch_mode is None:
        add(
            Factor(
                "automation",
                "no_fetch_metadata",
                -0.1,
                "The request lacked standard browser fetch metadata.",
            )
        )

    if t is not None:
        if t.webdriver:
            add(
                Factor(
                    "automation",
                    "webdriver",
                    -0.55,
                    "The browser reports it is controlled by automation.",
                )
            )
        if ctx.response.input_method == "touch" and t.max_touch_points == 0:
            add(
                Factor(
                    "session",
                    "touch_without_touchscreen",
                    -0.25,
                    "Touch input was reported on a device without touch support.",
                )
            )
        if t.page_dwell_ms is not None and t.page_dwell_ms < 800:
            add(
                Factor(
                    "session",
                    "instant_page_use",
                    -0.15,
                    "The page was used almost immediately after loading.",
                )
            )
        if t.visibility_changes:
            add(
                Factor(
                    "session",
                    "page_hidden",
                    -0.05,
                    "The page was hidden during the challenge.",
                )
            )

    return _finish("session_consistency", 0.93, factors, "Session properties stayed coherent.")


# ── request_behavior ────────────────────────────────────────────────────────


def request_behavior(ctx: SignalContext) -> SignalEvaluation:
    rates, network = ctx.rates, ctx.network
    factors: list[Factor] = []
    add = factors.append

    sessions = rates.sessions_from_ip_10m
    if sessions > 30:
        add(Factor("rate", "session_flood", -0.5, "Very high session volume from this network."))
    elif sessions > 12:
        add(Factor("rate", "session_burst", -0.25, "Elevated session volume from this network."))
    elif sessions > 6:
        add(
            Factor(
                "rate",
                "session_repeat",
                -0.08,
                "Requests arrived faster than the flow usually allows.",
            )
        )

    challenges = rates.challenges_from_ip_10m
    if challenges > 30:
        add(Factor("rate", "challenge_flood", -0.3, "Very frequent challenge submissions."))
    elif challenges > 15:
        add(
            Factor(
                "rate",
                "challenge_burst",
                -0.12,
                "Frequent challenge submissions from this network.",
            )
        )

    blocked = rates.blocked_from_ip_1h
    if blocked >= 3:
        add(Factor("rate", "blocked_history", -0.25, "Recent blocked sessions from this network."))
    elif blocked >= 1:
        add(Factor("rate", "blocked_recently", -0.1, "A recent session from this network failed."))

    if network.blocklisted:
        add(Factor("network", "blocklisted", -0.5, "The network is on the blocklist."))
    if network.datacenter:
        add(
            Factor(
                "network",
                "datacenter",
                -0.25,
                "Traffic originates from a hosting-provider network.",
            )
        )
    if network.kind in ("private", "loopback"):
        add(Factor("network", "local_network", 0.0, "Local network address."))

    return _finish(
        "request_behavior", 0.92, factors, "Request cadence matched the configured flow."
    )
