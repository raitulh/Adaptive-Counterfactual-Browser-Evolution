"""Paragraph-aware, overlapping chunking and lossless reconstruction."""

from __future__ import annotations

from itertools import pairwise

import pytest

from app.files.processing import chunk_text, reconstruct_text


def _paragraphs(count: int) -> str:
    return "\n\n".join(
        f"Paragraph {i} talks about topic {i}. " + " ".join(f"word{i}_{j}" for j in range(25))
        for i in range(count)
    )


def _norm(text: str) -> str:
    return " ".join(text.split())


def test_chunks_are_bounded_exact_slices_with_overlap() -> None:
    text = _paragraphs(12)
    chunks = chunk_text(text, target_chars=400, overlap_chars=80)
    assert len(chunks) > 3
    for i, chunk in enumerate(chunks):
        assert chunk.index == i
        assert 0 < len(chunk.content) <= 400
        assert text[chunk.start:chunk.end] == chunk.content
        assert chunk.content == chunk.content.strip()
    for prev, nxt in pairwise(chunks):
        assert nxt.start < prev.end, "consecutive chunks overlap"
        assert nxt.start > prev.start, "chunking always makes progress"
    assert chunks[-1].end == len(text.rstrip())


def test_chunks_prefer_paragraph_and_word_boundaries() -> None:
    text = _paragraphs(12)
    for chunk in chunk_text(text, target_chars=400, overlap_chars=0):
        assert chunk.end == len(text) or text[chunk.end].isspace()
        assert chunk.start == 0 or text[chunk.start - 1].isspace()
    para_ends = sum(1 for c in chunk_text(text, target_chars=600, overlap_chars=0)
                    if text[c.end:c.end + 2] == "\n\n")
    assert para_ends >= 3


def test_reconstruction_round_trips() -> None:
    text = _paragraphs(20)
    for overlap in (0, 50, 200):
        chunks = chunk_text(text, target_chars=300, overlap_chars=overlap)
        rebuilt = reconstruct_text((c.content, c.start, c.end) for c in chunks)
        assert _norm(rebuilt) == _norm(text)


def test_long_unbroken_token_is_hard_split() -> None:
    text = "x" * 5000
    chunks = chunk_text(text, target_chars=1000, overlap_chars=100)
    assert all(len(c.content) <= 1000 for c in chunks)
    assert reconstruct_text((c.content, c.start, c.end) for c in chunks) == text


def test_edge_cases() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []
    assert [c.content for c in chunk_text("  short text  ")] == ["short text"]
    assert len(chunk_text(_paragraphs(50), target_chars=100, max_chunks=5)) == 5
    with pytest.raises(ValueError):
        chunk_text("abc", target_chars=10)


def test_default_chunk_size_is_about_1200_chars() -> None:
    chunks = chunk_text(_paragraphs(40))
    assert all(len(c.content) <= 1200 for c in chunks)
    assert max(len(c.content) for c in chunks) > 600
