"""Malware scanning of uploaded bytes.

``ClamAVScanner`` speaks the clamd ``INSTREAM`` protocol over TCP (length-prefixed
chunks, zero-length terminator) with a hard overall timeout. ``NoopScanner`` is
for development only and reports ``skipped``. Callers treat ``error`` as
fail-closed: an upload whose scan could not complete is rejected, not stored.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import struct
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class ScanStatus:
    PENDING = "pending"
    CLEAN = "clean"
    INFECTED = "infected"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class ScanResult:
    status: str
    signature: str | None = None
    scanner: str = "none"
    detail: str | None = None

    @property
    def is_infected(self) -> bool:
        return self.status == ScanStatus.INFECTED


class MalwareScanner(Protocol):
    name: str

    async def scan(self, data: bytes) -> ScanResult: ...


class NoopScanner:
    name = "none"

    async def scan(self, data: bytes) -> ScanResult:
        return ScanResult(status=ScanStatus.SKIPPED, scanner=self.name)


class ClamAVScanner:
    name = "clamav"

    def __init__(self, host: str, port: int, *, timeout_seconds: float = 30.0, chunk_size: int = 64 * 1024,
                 max_response_bytes: int = 4096) -> None:
        self.host = host
        self.port = port
        self.timeout_seconds = timeout_seconds
        self.chunk_size = chunk_size
        self.max_response_bytes = max_response_bytes

    async def scan(self, data: bytes) -> ScanResult:
        writer: asyncio.StreamWriter | None = None
        try:
            async with asyncio.timeout(self.timeout_seconds):
                reader, writer = await asyncio.open_connection(self.host, self.port)
                writer.write(b"zINSTREAM\0")
                for offset in range(0, len(data), self.chunk_size):
                    chunk = data[offset:offset + self.chunk_size]
                    writer.write(struct.pack("!I", len(chunk)) + chunk)
                    await writer.drain()
                writer.write(struct.pack("!I", 0))
                await writer.drain()
                raw = await self._read_reply(reader)
        except (TimeoutError, OSError, asyncio.IncompleteReadError) as exc:
            logger.warning("clamav scan failed", extra={"error": type(exc).__name__})
            return ScanResult(status=ScanStatus.ERROR, scanner=self.name, detail=type(exc).__name__)
        finally:
            if writer is not None:
                writer.close()
                with contextlib.suppress(TimeoutError, OSError):
                    await asyncio.wait_for(writer.wait_closed(), timeout=2)
        return parse_clamd_reply(raw, scanner=self.name)

    async def _read_reply(self, reader: asyncio.StreamReader) -> bytes:
        buf = bytearray()
        while len(buf) < self.max_response_bytes:
            chunk = await reader.read(1024)
            if not chunk:
                break
            buf.extend(chunk)
            if b"\0" in chunk or b"\n" in chunk:
                break
        return bytes(buf)


def parse_clamd_reply(raw: bytes, *, scanner: str = "clamav") -> ScanResult:
    """Parse ``stream: OK`` / ``stream: <signature> FOUND`` / ``... ERROR``."""
    text = raw.split(b"\0", 1)[0].decode("utf-8", errors="replace").strip()
    body = text.split(":", 1)[1].strip() if ":" in text else text
    if body == "OK":
        return ScanResult(status=ScanStatus.CLEAN, scanner=scanner)
    if body.endswith(" FOUND"):
        signature = body[: -len(" FOUND")].strip()[:200] or "unknown"
        return ScanResult(status=ScanStatus.INFECTED, signature=signature, scanner=scanner)
    return ScanResult(status=ScanStatus.ERROR, scanner=scanner, detail=(body or "empty reply")[:200])


def build_scanner(settings: Settings | None = None) -> MalwareScanner:
    settings = settings or get_settings()
    if settings.malware_scanner == "clamav":
        return ClamAVScanner(settings.clamav_host, settings.clamav_port)
    return NoopScanner()


_scanner: MalwareScanner | None = None


def get_scanner() -> MalwareScanner:
    global _scanner
    if _scanner is None:
        _scanner = build_scanner(get_settings())
    return _scanner


def set_scanner(scanner: MalwareScanner | None) -> None:
    global _scanner
    _scanner = scanner
