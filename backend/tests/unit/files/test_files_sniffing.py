"""Content sniffing: magic bytes / structure decide the type, never the client or the filename."""

from __future__ import annotations

import io
import json
import time
import zipfile

import pytest
from files_samples import (
    DOCX_CONTENT_TYPES,
    ELF_BYTES,
    EXE_BYTES,
    GIF_BYTES,
    JPEG_BYTES,
    PNG_BYTES,
    RANDOM_BINARY,
    WEBP_BYTES,
    make_docx,
    make_pdf,
    make_xlsx,
)

from app.core.exceptions import ValidationFailed
from app.files.processing import (
    CSV,
    DOCX,
    GIF,
    HTML,
    JPEG,
    JSON,
    MARKDOWN,
    PDF,
    PNG,
    TEXT_PLAIN,
    WEBP,
    XLSX,
    UnsupportedFileType,
    sniff_content_type,
)


@pytest.mark.parametrize(("data", "expected"), [
    (make_pdf(["hello"]), PDF),
    (PNG_BYTES, PNG),
    (JPEG_BYTES, JPEG),
    (GIF_BYTES, GIF),
    (WEBP_BYTES, WEBP),
    (make_docx(["hello"]), DOCX),
    (make_xlsx([["a", "b"]]), XLSX),
    (b"Just some plain notes.\nSecond line.", TEXT_PLAIN),
    ("Grüße aus München — ünïcödé".encode(), TEXT_PLAIN),
    (b"\xef\xbb\xbfBOM prefixed text", TEXT_PLAIN),
    (b"name,age,city\nalice,30,paris\nbob,25,rome\n", CSV),
    (json.dumps({"a": [1, 2, {"b": None}]}).encode(), JSON),
    (b"# Title\n\nSome *markdown* with a [link](https://example.com).\n\n- item\n", MARKDOWN),
    (b"<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p></body></html>", HTML),
])
def test_sniffs_by_content(data: bytes, expected: str) -> None:
    assert sniff_content_type(data) == expected


@pytest.mark.parametrize("data", [EXE_BYTES, ELF_BYTES, b"#!/bin/sh\nrm -rf /\n", RANDOM_BINARY,
                                  b"\x00\x01\x02binary", b"\xff\xfe\x00h\x00i", b"\x00asm\x01\x00\x00\x00"])
def test_rejects_executables_and_unknown_binary(data: bytes) -> None:
    with pytest.raises(ValidationFailed) as exc:
        sniff_content_type(data)
    assert exc.value.code == "unsupported_file_type"
    assert exc.value.status_code == 422


def test_filename_hint_cannot_make_binary_acceptable() -> None:
    for hint in ("notes.txt", "data.csv", "readme.md", "doc.pdf"):
        with pytest.raises(UnsupportedFileType):
            sniff_content_type(EXE_BYTES, filename_hint=hint)


def test_filename_hint_only_picks_text_subtype() -> None:
    assert sniff_content_type(b"plain words here", filename_hint="notes.md") == MARKDOWN
    assert sniff_content_type(b"plain words here", filename_hint="x.png") == TEXT_PLAIN
    # A PNG named .txt is still a PNG.
    assert sniff_content_type(PNG_BYTES, filename_hint="notes.txt") == PNG


def _zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_rejects_plain_zip_macro_documents_and_broken_archives() -> None:
    with pytest.raises(UnsupportedFileType):
        sniff_content_type(_zip({"a.txt": b"hello"}))
    with pytest.raises(UnsupportedFileType):
        sniff_content_type(make_docx(["x"], extra={"word/vbaProject.bin": b"\x00macro"}))
    with pytest.raises(UnsupportedFileType):  # manifest claims DOCX but the main part is missing
        sniff_content_type(_zip({"[Content_Types].xml": DOCX_CONTENT_TYPES}))
    with pytest.raises(UnsupportedFileType):
        sniff_content_type(b"PK\x03\x04truncated-archive")


def test_rejects_empty() -> None:
    with pytest.raises(UnsupportedFileType):
        sniff_content_type(b"")


@pytest.mark.parametrize("payload", ["[" * 400_000, "[a" * 200_000, ("\n" + " " * 10) * 50_000,
                                     "- " * 200_000, "**" + "a" * 400_000, "<" * 400_000])
def test_sniffing_is_linear_on_adversarial_text(payload: str) -> None:
    started = time.monotonic()
    sniff_content_type(payload.encode())
    assert time.monotonic() - started < 2.0
