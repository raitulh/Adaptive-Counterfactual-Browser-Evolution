from __future__ import annotations

from dataclasses import replace

from app.schemas.verification import ChallengeResponseIn, ChallengeTelemetry
from app.services.network import NetworkInfo, RequestMeta
from app.services.signal_engine import (
    ClientFingerprint,
    RateStats,
    SignalContext,
    evaluate_signals,
)

FP = ClientFingerprint(ip_hash="ip", ua_hash="ua", lang_hash="lang", origin="app.example.com")
META = RequestMeta(
    ip="203.0.113.9",
    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
    accept_language="en-US",
    origin="app.example.com",
    sec_fetch_mode="cors",
    sec_fetch_site="cross-site",
)
HUMAN = ChallengeTelemetry(
    pointer_type="mouse",
    approach_moves=18,
    approach_straightness=0.82,
    approach_speed_cv=0.7,
    time_to_first_input_ms=640,
    untrusted_events=0,
    webdriver=False,
    max_touch_points=0,
    page_dwell_ms=9000,
)


def context(**overrides) -> SignalContext:
    base = SignalContext(
        response=ChallengeResponseIn(
            type="press_hold", input_method="pointer", hold_duration_ms=1105, telemetry=HUMAN
        ),
        session_age_ms=2400,
        prior_attempts=0,
        started=FP,
        current=FP,
        meta=META,
        network=NetworkInfo(kind="public"),
        rates=RateStats(),
    )
    return replace(base, **overrides)


def by_id(ctx):
    return {signal.id: signal for signal in evaluate_signals(ctx)}


def with_telemetry(**fields) -> ChallengeResponseIn:
    return ChallengeResponseIn(
        type="press_hold",
        input_method="pointer",
        hold_duration_ms=1105,
        telemetry=HUMAN.model_copy(update=fields),
    )


def test_human_baseline_passes_everything():
    signals = by_id(context())
    assert list(signals) == [
        "interaction_pattern",
        "challenge_response",
        "session_consistency",
        "request_behavior",
    ]
    assert all(signal.score >= 0.9 for signal in signals.values())
    assert signals["interaction_pattern"].detail == "Input timing varied naturally during the hold."


def test_every_factor_is_explained():
    ctx = context(response=with_telemetry(untrusted_events=2, webdriver=True))
    for signal in evaluate_signals(ctx):
        for factor in signal.factors:
            assert factor.note and factor.family


def test_untrusted_events_fail_interaction():
    signal = by_id(context(response=with_telemetry(untrusted_events=3)))["interaction_pattern"]
    assert signal.score < 0.5
    assert "Synthetic" in signal.detail


def test_linear_constant_speed_path_is_automation():
    ctx = context(response=with_telemetry(approach_straightness=0.998, approach_speed_cv=0.02))
    assert by_id(ctx)["interaction_pattern"].score < 0.5


def test_no_movement_is_only_mild():
    signal = by_id(context(response=with_telemetry(approach_moves=0)))["interaction_pattern"]
    assert 0.75 <= signal.score < 0.9


def test_superhuman_reaction():
    signal = by_id(context(response=with_telemetry(time_to_first_input_ms=30)))[
        "interaction_pattern"
    ]
    assert signal.score < 0.75


def test_input_method_mismatch():
    ctx = context(response=with_telemetry(pointer_type="touch"))
    assert "did not match" in by_id(ctx)["interaction_pattern"].detail


def test_hold_timing_checks():
    too_short = by_id(context(response=replace_hold(400)))["challenge_response"]
    impossible = by_id(context(session_age_ms=500))["challenge_response"]
    no_reaction = by_id(context(session_age_ms=1200))["challenge_response"]
    assert too_short.score < 0.5 and impossible.score < 0.5
    assert 0.5 <= no_reaction.score < 0.75


def replace_hold(ms: int) -> ChallengeResponseIn:
    return ChallengeResponseIn(
        type="press_hold", input_method="pointer", hold_duration_ms=ms, telemetry=HUMAN
    )


def test_session_consistency_checks():
    changed = by_id(context(current=replace(FP, ua_hash="other")))["session_consistency"]
    assert changed.score < 0.5
    ip_changed = by_id(context(current=replace(FP, ip_hash="other")))["session_consistency"]
    assert ip_changed.score >= 0.75  # networks change (mobile); only a mild signal
    webdriver = by_id(context(response=with_telemetry(webdriver=True)))["session_consistency"]
    assert webdriver.score < 0.5
    curl = by_id(context(meta=replace(META, user_agent="curl/8.4.0")))["session_consistency"]
    assert curl.score < 0.5
    no_headers = by_id(context(meta=replace(META, accept_language=None, sec_fetch_mode=None)))
    assert no_headers["session_consistency"].score < 0.75


def test_cubot_phone_is_not_a_bot():
    ua = "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile"
    signal = by_id(context(meta=replace(META, user_agent=ua)))["session_consistency"]
    assert signal.score >= 0.9


def test_touch_claim_without_touchscreen():
    response = ChallengeResponseIn(
        type="press_hold",
        input_method="touch",
        hold_duration_ms=1105,
        telemetry=HUMAN.model_copy(update={"pointer_type": "touch", "hold_moves": 3}),
    )
    assert by_id(context(response=response))["session_consistency"].score < 0.75


def test_rate_and_network():
    flood = by_id(context(rates=RateStats(sessions_from_ip_10m=50)))["request_behavior"]
    assert flood.score < 0.5
    blocklisted = by_id(context(network=NetworkInfo(kind="public", blocklisted=True)))
    assert blocklisted["request_behavior"].score < 0.5
    datacenter = by_id(context(network=NetworkInfo(kind="public", datacenter=True)))
    assert 0.5 <= datacenter["request_behavior"].score < 0.75
    local = by_id(context(network=NetworkInfo(kind="loopback")))["request_behavior"]
    assert local.score >= 0.9


def test_scores_stay_in_range():
    ctx = context(
        response=with_telemetry(untrusted_events=9, webdriver=True, time_to_first_input_ms=1),
        meta=replace(META, user_agent="", accept_language=None, sec_fetch_mode=None),
        current=ClientFingerprint("x", "y", "z", "evil.example"),
        rates=RateStats(99, 99, 99),
        network=NetworkInfo(kind="public", blocklisted=True, datacenter=True),
        session_age_ms=10,
    )
    for signal in evaluate_signals(ctx):
        assert 0 <= signal.score <= 1
