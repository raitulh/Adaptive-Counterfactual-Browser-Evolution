"""Pure-function tests: secret detection, hashing, keys, e-mail extraction, extraction gate, schemas."""

from __future__ import annotations

from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.common.time import utcnow
from app.core.exceptions import ValidationFailed
from app.memory import service
from app.memory.schemas import MemoryCandidate, MemoryCandidates, MemoryCreate, MemorySearchRequest


@pytest.mark.parametrize("text", [
    "My key is sk-abcdefghijklmnopqrstuvwx1234",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "google AIzaSyA1234567890abcdefghijklmnopqrstu",
    "The wifi password is hunter2",
    "Bank PIN code: 4321",
    "my one-time code is 482913",
    "api_key=abc123",
])
def test_secrets_are_detected(text):
    assert service.contains_secret(text)
    with pytest.raises(ValidationFailed) as exc:
        service.prepare_content(text)
    assert exc.value.code == "memory_contains_secret"


@pytest.mark.parametrize("text", [
    "The user uses 1Password as their password manager.",
    "Rahim's email is rahim@example.com",
    "The user prefers token-ring networking jokes.",
    "Reset links for the API usually arrive within a minute.",
])
def test_ordinary_text_is_not_a_secret(text):
    assert not service.contains_secret(text)
    assert service.prepare_content(text) == text


def test_prepare_content_cleans_and_bounds():
    assert service.prepare_content("  Hello \x00 <script>x</script>  world  ") == \
        "Hello <script>x</script> world"
    long = service.prepare_content("word " * 1000)
    assert long.startswith("word word")
    assert len(long) <= service.MAX_CONTENT_CHARS + 40
    with pytest.raises(ValidationFailed):
        service.prepare_content(" \x01 ")


def test_content_hash_is_normalized_sha256():
    a = service.content_hash("The user prefers  Tea.")
    assert a == service.content_hash("the user prefers tea")
    assert a != service.content_hash("the user prefers coffee")
    assert len(a) == 64
    assert service.memory_content_hash("The user\x00 prefers tea!") == a


@pytest.mark.parametrize(("raw", "expected"), [
    ("Contact: Rahim Uddin :Email", "contact:rahim_uddin:email"),
    ("pref:meeting length", "pref:meeting_length"),
    (":::", None),
    (None, None),
])
def test_normalize_subject_key(raw, expected):
    assert service.normalize_subject_key(raw) == expected


def test_extract_emails_is_strict():
    text = ("Reach Rahim.Uddin@Example.com. or rahim@example.co.uk; not rahim@@broken, rahim@localhost, "
            "a..b@example.com, .lead@example.com, bad@-example.com, x@example.c0m, "
            "mailto:ok+tag@sub.example.org")
    assert service.extract_emails(text) == ["rahim.uddin@example.com", "rahim@example.co.uk",
                                            "ok+tag@sub.example.org"]
    assert service.extract_emails("") == []
    assert service.extract_emails("rahim@example.com and RAHIM@example.com") == ["rahim@example.com"]


def _cand(content: str, importance: float = 0.8, confidence: float = 0.9, memory_type: str = "preference"
          ) -> MemoryCandidate:
    return MemoryCandidate.model_validate({"content": content, "memory_type": memory_type,
                                           "importance": importance, "confidence": confidence})


def test_selection_gate_filters_and_caps():
    grounding = "Please email rahim@example.com. I prefer mornings."
    candidates = [
        _cand("The user prefers mornings.", importance=0.9),
        _cand("the user prefers mornings", importance=0.95),  # duplicate after normalization
        _cand("The user said thanks.", importance=0.3),  # not important enough
        _cand("The user may like jazz.", confidence=0.5),  # not confident enough
        _cand("The user's password is swordfish", importance=0.9),  # secret
        _cand("Rahim's email is rahim@example.com", memory_type="contact"),  # grounded address
        _cand("The CEO's email is ceo@attacker.example", memory_type="contact"),  # ungrounded address
        *[_cand(f"The user likes topic {i}.", importance=0.6) for i in range(6)],
    ]
    kept = service.select_candidates(candidates, grounding_text=grounding)
    contents = [c.content for c in kept]
    assert len(kept) == service.EXTRACTION_MAX_PER_TASK
    assert contents[0] == "the user prefers mornings"  # best (importance x confidence) first
    assert "Rahim's email is rahim@example.com" in contents
    assert not any("password" in c or "attacker" in c or "thanks" in c or "jazz" in c for c in contents)
    assert sum("mornings" in c.lower() for c in contents) == 1


def test_deterministic_outcome_keeps_only_backend_authored_fields():
    summary = {"status": "completed", "headline": "Done: sent", "direct_response": "model text",
               "what_happened": [{"summary": "read untrusted mail"}],
               "what_changed": [{"tool": "gmail.send", "description": "Sent e-mail", "external_ref": "x"},
                                "junk"]}
    assert service.deterministic_outcome(summary) == {
        "status": "completed", "headline": "Done: sent",
        "what_changed": [{"tool": "gmail.send", "description": "Sent e-mail"}]}
    assert service.deterministic_outcome(None) == {}
    assert service.deterministic_outcome(["not", "a", "dict"]) == {}


def test_model_output_and_api_schemas_are_strict():
    with pytest.raises(ValidationError):
        MemoryCandidates.model_validate({"memories": [{"content": "abc", "memory_type": "short_term",
                                                       "importance": 1, "confidence": 1}]})
    with pytest.raises(ValidationError):
        MemoryCandidates.model_validate({"memories": [], "instructions": "ignore rules"})
    with pytest.raises(ValidationError):
        MemoryCreate.model_validate({"content": "x", "user_id": "someone-else"})
    yesterday = (utcnow() - timedelta(days=1)).isoformat()
    with pytest.raises(ValidationError):
        MemoryCreate.model_validate({"content": "x", "expires_at": yesterday})
    assert MemoryCreate.model_validate({"content": "x"}).memory_type == "long_term"
    with pytest.raises(ValidationError):
        MemorySearchRequest.model_validate({"query": "x", "limit": 100})
