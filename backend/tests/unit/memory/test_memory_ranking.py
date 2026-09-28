"""Pure-function tests: freshness, scoring, reranking, query parsing."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.memory import service
from app.memory.schemas import RetrievedMemory

NOW = datetime(2026, 6, 1, tzinfo=UTC)


@pytest.mark.parametrize(("memory_type", "age_days", "expected"), [
    ("contact", 179, "fresh"), ("contact", 181, "stale"),
    ("preference", 364, "fresh"), ("preference", 366, "stale"),
    ("verified_fact", 89, "fresh"), ("verified_fact", 91, "stale"),
    ("semantic", 366, "stale"), ("long_term", 300, "fresh"),
    ("task_history", 91, "stale"),
    ("short_term", 0.5, "fresh"), ("short_term", 2, "stale"),
    ("conversational", 6, "fresh"), ("conversational", 8, "stale"),
])
def test_freshness_uses_per_type_max_age(memory_type, age_days, expected):
    verified = NOW - timedelta(days=age_days)
    assert service.compute_freshness(memory_type, 0.9, verified, now=NOW) == expected


def test_low_confidence_or_conflicted_is_unverified_regardless_of_age():
    assert service.compute_freshness("contact", 0.49, NOW, now=NOW) == "unverified"
    assert service.compute_freshness("contact", 0.5, NOW, now=NOW) == "fresh"
    assert service.compute_freshness("contact", 1.0, NOW, status="conflicted", now=NOW) == "unverified"
    # Naive timestamps (e.g. from a driver) are treated as UTC, not rejected.
    assert service.compute_freshness("contact", 0.9, NOW.replace(tzinfo=None), now=NOW) == "fresh"


def _score(**overrides):
    params = {"semantic": 0.6, "keyword": 0.6, "importance": 0.5, "confidence": 0.8, "recency": 1.0,
              "freshness": "fresh", "status": "active", "task_relevance": 0.8}
    params.update(overrides)
    return service.score_memory(**params)


def test_score_blends_signals_and_penalizes_stale_and_conflicted():
    base = _score()
    assert _score(freshness="stale") == pytest.approx(base - service.STALE_PENALTY)
    assert _score(status="conflicted") == pytest.approx(base - service.CONFLICT_PENALTY)
    assert _score(importance=0.9) > base
    assert _score(confidence=0.3) < base
    assert _score(recency=0.1) < base
    assert _score(task_relevance=1.0) > _score(task_relevance=0.4)
    # Either relevance signal alone can surface a memory; together they reinforce.
    assert _score(semantic=0.0, keyword=0.9) > _score(semantic=0.0, keyword=0.0)
    assert _score(semantic=0.9, keyword=0.9) > _score(semantic=0.9, keyword=0.0)
    # Relevance dominates: an irrelevant but important memory ranks below a relevant one.
    assert _score(semantic=0, keyword=0, importance=1, confidence=1) < _score(semantic=0.9, keyword=0.9)
    assert _score(semantic=0, keyword=0, importance=0, confidence=0, recency=0, task_relevance=0,
                  freshness="stale", status="conflicted") == 0.0


def test_task_prior_prefers_actionable_layers():
    assert service.task_prior("preference") > service.task_prior("long_term") > service.task_prior(
        "conversational")
    assert service.task_prior("unknown") == service.DEFAULT_TASK_PRIOR


def test_similarity_calibration_and_recency_decay():
    assert service.calibrate_similarity(service.MIN_SEMANTIC_SIMILARITY) == 0.0
    assert service.calibrate_similarity(0.1) == 0.0
    assert service.calibrate_similarity(1.0) == 1.0
    assert service.recency_weight(NOW, NOW) == pytest.approx(1.0)
    half = NOW - timedelta(days=service.RECENCY_HALF_LIFE_DAYS)
    assert service.recency_weight(half, NOW) == pytest.approx(0.5)
    assert service.recency_weight(NOW + timedelta(days=1), NOW) == pytest.approx(1.0)


def _memory(content: str, score: float, subject_key: str | None = None) -> RetrievedMemory:
    return RetrievedMemory(id=uuid.uuid4(), content=content, memory_type="long_term", confidence=0.9,
                           importance=0.5, score=score, freshness="fresh", source_type="user_stated",
                           source_reference="user", last_verified_at=NOW, subject_key=subject_key)


def test_rerank_orders_by_score_and_suppresses_near_duplicates():
    a = _memory("The user prefers morning meetings.", 0.9)
    near_dup = _memory("The user prefers morning meetings!", 0.85)
    same_subject_hi = _memory("Rahim's email is rahim@example.com", 0.8, "contact:rahim:email")
    same_subject_lo = _memory("Rahim's email is rahim.old@example.com", 0.7, "contact:rahim:email")
    other = _memory("The user is allergic to peanuts.", 0.5)
    ranked = service.rerank([other, same_subject_lo, near_dup, a, same_subject_hi], limit=10)
    assert ranked == [a, same_subject_hi, other]
    assert service.rerank([other, a, same_subject_hi], limit=2) == [a, same_subject_hi]
    assert service.rerank([], limit=5) == []


@pytest.mark.parametrize(("query", "positive", "excluded"), [
    ("meetings with Rahim", "meetings with Rahim", []),
    ("tea -hiking", "tea", ["hiking"]),
    ('user -"green tea" morning', "user morning", ["green tea"]),
    ("-only -exclusions", "", ["only", "exclusions"]),
    ("well-known e-mail - dash", "well-known e-mail - dash", []),
    ('"quoted phrase" rest', '"quoted phrase" rest', []),
])
def test_split_query_separates_exclusions(query, positive, excluded):
    assert service.split_query(query) == (positive, excluded)
