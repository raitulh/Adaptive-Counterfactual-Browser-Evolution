"""Content sniffing and the document processing pipeline.

* ``sniff_content_type`` decides the type from magic bytes / structure only —
  the client-declared Content-Type is never trusted — and enforces the allowlist.
* ``extract_text`` turns a stored object into bounded plain text
  (txt/md/csv/json/html via stdlib, PDF via pypdf, DOCX/XLSX via zipfile + XML
  with DTD/ENTITY declarations rejected before parsing: no XXE, no billion laughs).
* ``chunk_text`` splits paragraph-aware, overlapping chunks that are exact slices
  of the extracted text (so readers can stitch them back together).
* ``process_file`` is the ``file.process`` worker pipeline: it never runs in a
  request, never holds a transaction across storage/model IO, and is idempotent
  (re-running replaces the file's chunks).
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import re
import uuid
import zipfile
import zlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import set_tenant_scope
from app.core.exceptions import ValidationFailed
from app.files.models import ExtractionStatus, File, FileMetadata, FileStatus
from app.files.storage import ObjectNotFound, ObjectStorage, get_storage
from app.model_gateway.types import CallMetadata
from app.search import service as search_service
from app.search.models import EMBEDDING_DIMENSIONS, SourceType
from app.usage.models import UsageKind
from app.usage.service import add_usage

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------- content types
PDF = "application/pdf"
PNG = "image/png"
JPEG = "image/jpeg"
GIF = "image/gif"
WEBP = "image/webp"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TEXT_PLAIN = "text/plain"
CSV = "text/csv"
MARKDOWN = "text/markdown"
JSON = "application/json"
HTML = "text/html"

IMAGE_TYPES = frozenset({PNG, JPEG, GIF, WEBP})
TEXT_TYPES = frozenset({TEXT_PLAIN, CSV, MARKDOWN, JSON, HTML})
WRITABLE_TEXT_TYPES = frozenset({TEXT_PLAIN, MARKDOWN, CSV})
ALLOWED_CONTENT_TYPES = frozenset({PDF, DOCX, XLSX, *IMAGE_TYPES, *TEXT_TYPES})

MAX_EXTRACTED_CHARS = 2_000_000
MAX_ZIP_ENTRIES = 5_000
MAX_XML_MEMBER_BYTES = 64 * 1024 * 1024
MAX_ZIP_RATIO = 200
MAX_PDF_PAGES = 2_000
MAX_SHEETS = 50
MAX_EMBED_CHUNKS = 1_000

_EXECUTABLE_MAGIC = (
    b"MZ",  # PE / DOS
    b"\x7fELF",
    b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe",  # Mach-O
    b"\xca\xfe\xba\xbe",  # Mach-O fat / Java class
    b"#!",  # scripts
    b"\x00asm",  # WebAssembly
    b"dex\n",  # Android
)


class UnsupportedFileType(ValidationFailed):
    code = "unsupported_file_type"
    message = "This file type is not supported."


class UnsafeDocument(ValidationFailed):
    code = "unsafe_document"
    message = "The document contains constructs that are not allowed."


class DocumentUnreadable(ValidationFailed):
    code = "document_unreadable"
    message = "The document could not be read."


# ---------------------------------------------------------------------------- sniffing
def sniff_content_type(data: bytes, *, filename_hint: str | None = None) -> str:
    """Determine the content type from the bytes. ``filename_hint`` can only choose between
    text subtypes (e.g. Markdown vs plain text); it never makes binary content acceptable."""
    if not data:
        raise UnsupportedFileType("The file is empty.", details={"reason": "empty"})
    if data.startswith(_EXECUTABLE_MAGIC):
        raise UnsupportedFileType("Executable files are not allowed.", details={"reason": "executable"})
    if data.startswith(b"%PDF-"):
        return PDF
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return GIF
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    if data.startswith(b"PK\x03\x04"):
        return _sniff_ooxml(data)
    text = _decode_text(data)
    if text is None:
        raise UnsupportedFileType(details={"reason": "unrecognized_binary"})
    return _classify_text(text, filename_hint)


def _sniff_ooxml(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise UnsupportedFileType(details={"reason": "archive_too_complex"})
            names = {info.filename for info in infos}
            if any(name.lower().endswith("vbaproject.bin") for name in names):
                raise UnsupportedFileType("Macro-enabled documents are not allowed.",
                                          details={"reason": "macros"})
            manifest = _read_zip_member(zf, "[Content_Types].xml", 1024 * 1024)
    except UnsupportedFileType:
        raise
    except (zipfile.BadZipFile, KeyError, RuntimeError, NotImplementedError, EOFError, zlib.error, OSError,
            ValueError, DocumentUnreadable, UnsafeDocument) as exc:
        raise UnsupportedFileType(details={"reason": "unsupported_archive"}) from exc
    if b"wordprocessingml.document.main+xml" in manifest and "word/document.xml" in names:
        return DOCX
    if b"spreadsheetml.sheet.main+xml" in manifest and "xl/workbook.xml" in names:
        return XLSX
    raise UnsupportedFileType(details={"reason": "unsupported_archive"})


def _decode_text(data: bytes) -> str | None:
    raw = data[3:] if data.startswith(b"\xef\xbb\xbf") else data
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    sample = text[:65536]
    if "\x00" in sample:
        return None
    controls = sum(1 for ch in sample if ord(ch) < 32 and ch not in "\t\n\r\f\v")
    if sample and controls / len(sample) > 0.01:
        return None
    return text


# Every pattern is linear-time on adversarial input (no unbounded class that can re-scan text
# already consumed by an earlier attempt): sniffing runs in the upload request path.
_MD_SIGNALS = (
    re.compile(r"^#{1,6}[ \t]+\S", re.M),
    re.compile(r"^[ \t]{0,3}[-*+][ \t]+\S", re.M),
    re.compile(r"^[ \t]{0,3}\d{1,9}\.[ \t]+\S", re.M),
    re.compile(r"^```", re.M),
    re.compile(r"\[[^\[\]\n]{1,300}\]\([^()\s]{1,1000}\)"),
    re.compile(r"(\*\*|__)[^*_\n]{1,300}(\*\*|__)"),
    re.compile(r"^>[ \t]", re.M),
    re.compile(r"^\|?[ \t]{0,20}:?-{3,}:?[ \t]{0,20}\|", re.M),
)


def _looks_like_json(text: str) -> bool:
    stripped = text.strip()
    if not stripped or stripped[0] not in "{[" or stripped[-1] not in "}]":
        return False
    try:
        json.loads(stripped)
    except (ValueError, RecursionError):
        return False
    return True


def _looks_like_html(text: str) -> bool:
    head = text.lstrip()[:4096].lower()
    if head.startswith("<!doctype html") or head.startswith("<html"):
        return True
    return head.startswith("<") and bool(re.search(r"<(head|body)[\s>]", head))


def _looks_like_csv(text: str) -> bool:
    lines = [line for line in text[:16384].splitlines() if line.strip()][:20]
    if len(text) > 16384 and len(lines) > 2:
        lines = lines[:-1]  # the sample may cut the last line
    if len(lines) < 2:
        return False
    for delimiter in (",", ";", "\t", "|"):
        try:
            rows = list(csv.reader(lines, delimiter=delimiter))
        except csv.Error:
            continue
        widths = {len(row) for row in rows}
        if len(widths) != 1:
            continue
        width = widths.pop()
        if width < 2 or (width == 2 and len(rows) < 3):
            continue
        cells = [cell for row in rows for cell in row]
        if sum(len(c) for c in cells) / max(1, len(cells)) <= 50:
            return True
    return False


def _looks_like_markdown(text: str) -> bool:
    sample = text[:32768]
    first = next((line for line in sample.splitlines() if line.strip()), "")
    if re.match(r"^#{1,6}[ \t]+\S", first):
        return True
    return sum(1 for pattern in _MD_SIGNALS if pattern.search(sample)) >= 2


def _classify_text(text: str, filename_hint: str | None) -> str:
    if _looks_like_json(text):
        return JSON
    if _looks_like_html(text):
        return HTML
    if _looks_like_csv(text):
        return CSV
    if _looks_like_markdown(text):
        return MARKDOWN
    hint = (filename_hint or "").lower()
    if hint.endswith((".md", ".markdown")):
        return MARKDOWN
    if hint.endswith((".csv", ".tsv")):
        return CSV
    return TEXT_PLAIN


# ---------------------------------------------------------------------------- safe XML / zip
_DTD_RE = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.I)
_XML_ENCODING_RE = re.compile(rb"^\s*<\?xml[^>]*?encoding\s*=\s*[\"']([A-Za-z0-9._-]+)[\"']", re.I)
_ALLOWED_XML_ENCODINGS = {b"utf-8", b"utf8", b"us-ascii", b"ascii"}


def ensure_safe_xml(xml: bytes) -> bytes:
    """Reject DTDs/entity declarations (XXE, billion laughs) and non-UTF-8 encodings that
    could hide them from the byte-level check, *before* any parser sees the document."""
    body = xml[3:] if xml.startswith(b"\xef\xbb\xbf") else xml
    if body.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" in body[:1024]:
        raise UnsafeDocument("Only UTF-8 XML is supported.", details={"reason": "encoding"})
    match = _XML_ENCODING_RE.match(body)
    if match and match.group(1).lower() not in _ALLOWED_XML_ENCODINGS:
        raise UnsafeDocument("Only UTF-8 XML is supported.", details={"reason": "encoding"})
    if _DTD_RE.search(body):
        raise UnsafeDocument("XML document type or entity declarations are not allowed.",
                             details={"reason": "dtd"})
    return body


def safe_xml_fromstring(xml: bytes) -> ElementTree.Element:
    body = ensure_safe_xml(xml)
    try:
        return ElementTree.fromstring(body)  # noqa: S314 - DTD/ENTITY rejected by ensure_safe_xml
    except ElementTree.ParseError as exc:
        raise DocumentUnreadable("The document XML is malformed.") from exc


def _iterparse(xml: bytes) -> Iterator[tuple[str, ElementTree.Element]]:
    body = ensure_safe_xml(xml)
    try:
        yield from ElementTree.iterparse(io.BytesIO(body), events=("start", "end"))  # noqa: S314
    except ElementTree.ParseError as exc:
        raise DocumentUnreadable("The document XML is malformed.") from exc


def _read_zip_member(zf: zipfile.ZipFile, name: str, limit: int) -> bytes:
    info = zf.getinfo(name)
    if info.file_size > limit:
        raise DocumentUnreadable("A document part is too large.", details={"reason": "too_large"})
    ratio = info.file_size / info.compress_size if info.compress_size else 0.0
    if info.file_size > 1024 * 1024 and ratio > MAX_ZIP_RATIO:
        raise UnsafeDocument("Suspicious compression ratio.", details={"reason": "zip_bomb"})
    with zf.open(info) as fh:
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise DocumentUnreadable("A document part is too large.", details={"reason": "too_large"})
    return data


def _open_zip(data: bytes) -> zipfile.ZipFile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError) as exc:
        raise DocumentUnreadable("The archive is corrupted.") from exc
    if len(zf.infolist()) > MAX_ZIP_ENTRIES:
        zf.close()
        raise UnsafeDocument("The archive has too many entries.", details={"reason": "zip_entries"})
    return zf


# ---------------------------------------------------------------------------- extraction
@dataclass(slots=True)
class ExtractionResult:
    status: str
    text: str = ""
    page_count: int | None = None
    truncated: bool = False
    title: str | None = None


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_W_PROPS = frozenset({f"{_W}pPr", f"{_W}rPr", f"{_W}sectPr", f"{_W}tblPr"})
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _extract_docx(data: bytes, max_chars: int) -> str:
    try:
        with _open_zip(data) as zf:
            xml = _read_zip_member(zf, "word/document.xml", MAX_XML_MEMBER_BYTES)
    except (KeyError, RuntimeError, NotImplementedError, EOFError, zlib.error, zipfile.BadZipFile) as exc:
        raise DocumentUnreadable("The document is corrupted.") from exc
    paragraphs: list[str] = []
    stack: list[list[str]] = []
    props_depth = 0  # inside w:pPr / w:rPr (tab-stop definitions are not content)
    total = 0
    for event, elem in _iterparse(xml):
        tag = elem.tag
        if event == "start":
            if tag == f"{_W}p":
                stack.append([])
            elif tag in _W_PROPS:
                props_depth += 1
            continue
        if tag in _W_PROPS:
            props_depth -= 1
        elif props_depth:
            continue
        elif tag == f"{_W}t" and stack:
            stack[-1].append(elem.text or "")
        elif tag == f"{_W}tab" and stack:
            stack[-1].append("\t")
        elif tag in (f"{_W}br", f"{_W}cr") and stack:
            stack[-1].append("\n")
        elif tag == f"{_W}p" and stack:
            text = "".join(stack.pop())
            paragraphs.append(text)
            total += len(text) + 2
            elem.clear()
            if total > max_chars:
                break
    return "\n\n".join(p for p in paragraphs if p.strip())


def _sheet_sort_key(name: str) -> int:
    match = re.search(r"(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0


def _extract_xlsx(data: bytes, max_chars: int) -> str:
    try:
        with _open_zip(data) as zf:
            names = set(zf.namelist())
            shared: list[str] = []
            if "xl/sharedStrings.xml" in names:
                strings_xml = _read_zip_member(zf, "xl/sharedStrings.xml", MAX_XML_MEMBER_BYTES)
                for event, elem in _iterparse(strings_xml):
                    if event == "end" and elem.tag == f"{_S}si":
                        shared.append("".join(t.text or "" for t in elem.iter(f"{_S}t")))
                        elem.clear()
            sheets = sorted((n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                            key=_sheet_sort_key)[:MAX_SHEETS]
            sections: list[str] = []
            total = 0
            for number, sheet in enumerate(sheets, start=1):
                rows: list[str] = []
                cells: list[str] = []
                for event, elem in _iterparse(_read_zip_member(zf, sheet, MAX_XML_MEMBER_BYTES)):
                    if event != "end":
                        continue
                    if elem.tag == f"{_S}c":
                        cells.append(_xlsx_cell_value(elem, shared))
                        elem.clear()
                    elif elem.tag == f"{_S}row":
                        line = " | ".join(c for c in cells if c)
                        cells = []
                        if line:
                            rows.append(line)
                            total += len(line) + 1
                        elem.clear()
                        if total > max_chars:
                            break
                if rows:
                    sections.append(f"Sheet {number}\n" + "\n".join(rows))
                if total > max_chars:
                    break
    except (KeyError, RuntimeError, NotImplementedError, EOFError, zlib.error, zipfile.BadZipFile) as exc:
        raise DocumentUnreadable("The spreadsheet is corrupted.") from exc
    return "\n\n".join(sections)


def _xlsx_cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(f"{_S}t"))
    value = cell.find(f"{_S}v")
    raw = (value.text or "") if value is not None else ""
    if kind == "s":
        try:
            index = int(raw)
        except ValueError:
            return ""
        return shared[index] if 0 <= index < len(shared) else ""
    return raw


def _extract_pdf(data: bytes, max_chars: int) -> tuple[str, int]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                decrypted = reader.decrypt("")
            except Exception as exc:
                raise DocumentUnreadable("Encrypted PDFs are not supported.",
                                         details={"reason": "encrypted"}) from exc
            if not decrypted:
                raise DocumentUnreadable("Encrypted PDFs are not supported.", details={"reason": "encrypted"})
        page_count = len(reader.pages)
    except DocumentUnreadable:
        raise
    except Exception as exc:  # pypdf raises a wide range of errors on malformed input
        raise DocumentUnreadable("The PDF is corrupted.") from exc
    parts: list[str] = []
    total = 0
    for index in range(min(page_count, MAX_PDF_PAGES)):
        try:
            text = reader.pages[index].extract_text() or ""
        except Exception:  # one bad page must not lose the rest of the document
            logger.info("pdf page extraction failed", extra={"page": index})
            text = ""
        parts.append(text)
        total += len(text)
        if total > max_chars:
            break
    return "\n\n".join(parts), page_count


def _decode_for_extraction(data: bytes) -> str:
    raw = data[3:] if data.startswith(b"\xef\xbb\xbf") else data
    return raw.decode("utf-8", errors="replace")


def normalize_extracted_text(text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> tuple[str, bool]:
    """Bound, normalise newlines and sanitise (control chars, boundary spoofing, whitespace)."""
    text = text[: max_chars * 2].replace("\r\n", "\n").replace("\r", "\n")
    text = search_service.clean_untrusted_text(text, max_chars=max_chars + 1)
    truncated = len(text) > max_chars
    return (text[:max_chars] if truncated else text), truncated


def extract_text(data: bytes, content_type: str, *, max_chars: int = MAX_EXTRACTED_CHARS) -> ExtractionResult:
    """Extract bounded plain text. Raises ``UnsafeDocument`` / ``DocumentUnreadable``."""
    if content_type in IMAGE_TYPES:
        return ExtractionResult(status=ExtractionStatus.SKIPPED)
    page_count: int | None = None
    title: str | None = None
    if content_type in (TEXT_PLAIN, MARKDOWN, CSV, JSON):
        raw = _decode_for_extraction(data)
    elif content_type == HTML:
        html = _decode_for_extraction(data)
        title = search_service.extract_html_title(html)
        raw = search_service.html_to_text(html)
    elif content_type == PDF:
        raw, page_count = _extract_pdf(data, max_chars)
    elif content_type == DOCX:
        raw = _extract_docx(data, max_chars)
    elif content_type == XLSX:
        raw = _extract_xlsx(data, max_chars)
    else:
        return ExtractionResult(status=ExtractionStatus.SKIPPED)
    text, truncated = normalize_extracted_text(raw, max_chars)
    status = ExtractionStatus.TRUNCATED if truncated else ExtractionStatus.COMPLETED
    return ExtractionResult(status=status, text=text, page_count=page_count, truncated=truncated, title=title)


# ---------------------------------------------------------------------------- chunking
@dataclass(frozen=True, slots=True)
class TextChunk:
    index: int
    content: str
    start: int
    end: int


_SENTENCE_END = re.compile(r"[.!?][\"')\]]?\s")


def _skip_ws(text: str, pos: int) -> int:
    n = len(text)
    while pos < n and text[pos].isspace():
        pos += 1
    return pos


def _find_break(text: str, start: int, limit: int, min_len: int) -> int:
    lo = start + min_len
    window = text[lo:limit]
    idx = window.rfind("\n\n")
    if idx != -1:
        return lo + idx + 2
    idx = window.rfind("\n")
    if idx != -1:
        return lo + idx + 1
    sentence_ends = [m.end() for m in _SENTENCE_END.finditer(window)]
    if sentence_ends:
        return lo + sentence_ends[-1]
    idx = max(window.rfind(" "), window.rfind("\t"))
    if idx != -1:
        return lo + idx + 1
    return limit


def _overlap_start(text: str, start: int, end: int, overlap: int) -> int:
    if overlap <= 0:
        return _skip_ws(text, end)
    candidate = max(end - overlap, start + 1)
    match = re.compile(r"\s").search(text, candidate, end)
    candidate = _skip_ws(text, match.end()) if match else end
    if candidate >= end or candidate <= start:
        return _skip_ws(text, end)
    return candidate


def chunk_text(text: str, *, target_chars: int = 1200, overlap_chars: int = 200,
               max_chunks: int = 5000) -> list[TextChunk]:
    """Paragraph-aware chunking with overlap. Each chunk is ``text[start:end]`` exactly."""
    if target_chars < 50:
        raise ValueError("target_chars must be >= 50")
    overlap_chars = max(0, min(overlap_chars, target_chars // 2))
    n = len(text)
    chunks: list[TextChunk] = []
    start = _skip_ws(text, 0)
    while start < n and len(chunks) < max_chunks:
        limit = start + target_chars
        end = n if limit >= n else _find_break(text, start, limit, target_chars // 2)
        s, e = start, end
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            chunks.append(TextChunk(index=len(chunks), content=text[s:e], start=s, end=e))
        if end >= n:
            break
        start = _overlap_start(text, start, end, overlap_chars)
    return chunks


def reconstruct_text(chunks: Iterable[tuple[str, int | None, int | None]]) -> str:
    """Stitch ``(content, start, end)`` chunks back together, removing overlaps."""
    parts: list[str] = []
    covered = -1
    for content, start, end in chunks:
        if start is None or end is None:
            parts.append(("\n\n" if parts else "") + content)
            continue
        if covered < 0:
            parts.append(content)
        elif start < covered:
            parts.append(content[covered - start:])
        else:
            parts.append(("\n" if start > covered else "") + content)
        covered = max(covered, end)
    return "".join(parts)


# ---------------------------------------------------------------------------- language
_STOPWORD_TEXT: dict[str, str] = {
    "en": "the and of to in is that for it with as was on are be this by not or have from",
    "es": "el la de que y en los del se las por un para con una es al lo como más pero",
    "fr": "le la les de des et en un une est que pour dans du au pas qui sur avec ce",
    "de": "der die das und ist nicht mit den von zu ein eine für auf dem des sich im auch",
    "pt": "o a os as de que e do da em um uma para com não por mais dos das se",
    "it": "il lo la gli le di che e un una per con non sono del della nel si è anche",
    "nl": "de het een en van is dat niet op te voor met zijn als ook aan er",
}
_STOPWORDS: dict[str, frozenset[str]] = {
    lang: frozenset(words.split()) for lang, words in _STOPWORD_TEXT.items()
}


def detect_language(text: str) -> str | None:
    words = re.findall(r"[^\W\d_]+", text[:20000].lower())
    if len(words) < 10:
        return None
    scores = sorted(((sum(1 for w in words if w in stop), lang) for lang, stop in _STOPWORDS.items()),
                    reverse=True)
    (best, lang), (second, _) = scores[0], scores[1]
    if best >= 5 and best >= 1.5 * max(1, second):
        return lang
    return None


# ---------------------------------------------------------------------------- pipeline
async def _embed_chunks(model_router: Any, chunks: list[TextChunk], *, tenant_id: uuid.UUID,
                        user_id: uuid.UUID) -> list[list[float] | None] | None:
    if model_router is None or not chunks:
        return None
    subset = [c.content for c in chunks[:MAX_EMBED_CHUNKS]]
    try:
        vectors = await model_router.embed(
            subset, task_type="RETRIEVAL_DOCUMENT",
            metadata=CallMetadata(purpose="files.index", tenant_id=tenant_id, user_id=user_id))
    except Exception as exc:  # embeddings are an optimisation; keyword search still works
        logger.warning("file embedding unavailable; indexing without vectors",
                       extra={"error": type(exc).__name__})
        return None
    if len(vectors) != len(subset) or any(len(v) != EMBEDDING_DIMENSIONS for v in vectors):
        logger.warning("embedding dimension mismatch; indexing without vectors")
        return None
    out: list[list[float] | None] = [list(v) for v in vectors]
    out.extend([None] * (len(chunks) - len(out)))
    return out


async def _mark_failed(session_factory: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID,
                       file_id: uuid.UUID, reason: str, *, extraction_status: str = ExtractionStatus.FAILED
                       ) -> str:
    async with session_factory() as session:
        set_tenant_scope(session, tenant_id)
        file = await _lock_file(session, file_id)
        if file is None or file.deleted_at is not None:
            await session.rollback()
            return FileStatus.DELETED
        file.status = FileStatus.FAILED
        file.error = reason[:500]
        meta = await _get_or_create_metadata(session, file)
        meta.extraction_status = extraction_status
        meta.extra = {**(meta.extra or {}), "error": reason[:200]}
        await session.commit()
    return FileStatus.FAILED


async def _lock_file(session: AsyncSession, file_id: uuid.UUID) -> File | None:
    stmt = select(File).where(File.id == file_id).with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def _get_or_create_metadata(session: AsyncSession, file: File) -> FileMetadata:
    meta = (await session.execute(select(FileMetadata).where(FileMetadata.file_id == file.id))
            ).scalar_one_or_none()
    if meta is None:
        meta = FileMetadata(tenant_id=file.tenant_id, file_id=file.id,
                            extraction_status=ExtractionStatus.PENDING, extra={})
        session.add(meta)
    return meta


async def process_file(session_factory: async_sessionmaker[AsyncSession], *, tenant_id: uuid.UUID,
                       file_id: uuid.UUID, storage: ObjectStorage | None = None,
                       model_router: Any | None = None) -> str:
    """Extract → chunk → (embed) → index a stored file. Returns the resulting file status."""
    storage = storage or get_storage()
    async with session_factory() as session:
        set_tenant_scope(session, tenant_id)
        file = await _lock_file(session, file_id)
        if file is None or file.deleted_at is not None or file.status in (FileStatus.QUARANTINED,
                                                                          FileStatus.DELETED):
            # Read before rollback: rollback expires the instance (a reload would be implicit IO).
            skipped = FileStatus.DELETED if file is None or file.deleted_at is not None else file.status
            await session.rollback()
            return skipped
        file.status = FileStatus.PROCESSING
        key, content_type, expected_sha = file.object_key, file.content_type, file.sha256
        user_id, filename = file.user_id, file.filename
        await session.commit()

    try:
        data = await storage.get_bytes(key)
    except ObjectNotFound:
        return await _mark_failed(session_factory, tenant_id, file_id, "stored object is missing")
    if hashlib.sha256(data).hexdigest() != expected_sha:
        return await _mark_failed(session_factory, tenant_id, file_id, "stored object checksum mismatch")

    try:
        result = await asyncio.to_thread(extract_text, data, content_type)
    except (UnsafeDocument, DocumentUnreadable) as exc:
        return await _mark_failed(session_factory, tenant_id, file_id, f"{exc.code}: {exc.message}")
    except Exception:  # deterministic parser failure: retrying the same bytes cannot help
        logger.exception("file extraction failed", extra={"file_id": str(file_id)})
        return await _mark_failed(session_factory, tenant_id, file_id,
                                  "document_unreadable: extraction failed")
    chunks = chunk_text(result.text) if result.text else []
    embeddings = await _embed_chunks(model_router, chunks, tenant_id=tenant_id, user_id=user_id)
    summary = search_service.clean_untrusted_text(result.text[:600], max_chars=500) if result.text else None

    async with session_factory() as session:
        set_tenant_scope(session, tenant_id)
        file = await _lock_file(session, file_id)
        if file is None or file.deleted_at is not None or file.status == FileStatus.DELETED:
            await session.rollback()
            return FileStatus.DELETED
        if chunks:
            await search_service.index_document(
                session, tenant_id=tenant_id, user_id=user_id, source_type=SourceType.FILE,
                source_id=str(file_id), title=result.title or filename, snippet=summary,
                content_hash=expected_sha,
                chunks=[search_service.IndexChunk(c.content, c.start, c.end) for c in chunks],
                embeddings=embeddings,
                metadata={"file_id": str(file_id), "content_type": content_type},
            )
        else:
            await search_service.delete_documents_for_sources(
                session, tenant_id=tenant_id, source_type=SourceType.FILE, source_ids=[str(file_id)])
        meta = await _get_or_create_metadata(session, file)
        meta.extraction_status = result.status
        meta.page_count = result.page_count
        meta.char_count = len(result.text)
        meta.chunk_count = len(chunks)
        meta.language = detect_language(result.text) if result.text else None
        meta.extracted_summary = summary
        meta.extra = {"embedded_chunks": sum(1 for e in (embeddings or []) if e is not None),
                      "truncated": result.truncated}
        file.status = FileStatus.READY
        file.error = None
        if embeddings:
            add_usage(session, tenant_id=tenant_id, user_id=user_id, kind=UsageKind.EMBEDDING,
                      quantity=float(sum(1 for e in embeddings if e is not None)),
                      metadata={"file_id": str(file_id), "purpose": "files.index"})
        await session.commit()
    return FileStatus.READY
