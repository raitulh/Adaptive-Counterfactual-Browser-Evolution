"""Malware scanning: clamd INSTREAM protocol against a fake TCP server, reply parsing, factory."""

from __future__ import annotations

import asyncio
import socket
import struct
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
import pytest_asyncio

from app.core.config import get_settings
from app.files.scanning import (
    ClamAVScanner,
    NoopScanner,
    ScanStatus,
    build_scanner,
    parse_clamd_reply,
)

Reply = Callable[[bytes], bytes | None]


class FakeClamd:
    def __init__(self, reply: Reply) -> None:
        self.reply = reply
        self.received: list[bytes] = []
        self.commands: list[bytes] = []

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            command = await reader.readuntil(b"\0")
            self.commands.append(command)
            data = bytearray()
            while True:
                (length,) = struct.unpack("!I", await reader.readexactly(4))
                if length == 0:
                    break
                data.extend(await reader.readexactly(length))
            self.received.append(bytes(data))
            answer = self.reply(bytes(data))
            if answer is None:
                await asyncio.sleep(10)
                return
            writer.write(answer)
            await writer.drain()
        finally:
            writer.close()


@pytest_asyncio.fixture
async def clamd() -> AsyncIterator[Callable[[Reply], Awaitable[tuple[FakeClamd, int]]]]:
    servers: list[asyncio.base_events.Server] = []

    async def _start(reply: Reply) -> tuple[FakeClamd, int]:
        fake = FakeClamd(reply)
        server = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
        servers.append(server)
        return fake, server.sockets[0].getsockname()[1]

    yield _start
    for server in servers:
        server.close()


async def test_noop_scanner_reports_skipped() -> None:
    result = await NoopScanner().scan(b"anything")
    assert result.status == ScanStatus.SKIPPED and not result.is_infected


async def test_clamav_clean_streams_all_chunks(clamd: Callable[[Reply], Awaitable[tuple[FakeClamd, int]]]) -> None:
    fake, port = await clamd(lambda data: b"stream: OK\0")
    payload = b"0123456789" * 7 + b"tail"
    result = await ClamAVScanner("127.0.0.1", port, timeout_seconds=5, chunk_size=16).scan(payload)
    assert result.status == ScanStatus.CLEAN
    assert fake.commands == [b"zINSTREAM\0"]
    assert fake.received == [payload]


async def test_clamav_infected(clamd: Callable[[Reply], Awaitable[tuple[FakeClamd, int]]]) -> None:
    _, port = await clamd(lambda data: b"stream: Win.Test.EICAR_HDB-1 FOUND\0")
    result = await ClamAVScanner("127.0.0.1", port, timeout_seconds=5).scan(b"X5O!P%@AP")
    assert result.is_infected
    assert result.signature == "Win.Test.EICAR_HDB-1"


async def test_clamav_timeout_is_error(clamd: Callable[[Reply], Awaitable[tuple[FakeClamd, int]]]) -> None:
    _, port = await clamd(lambda data: None)
    result = await ClamAVScanner("127.0.0.1", port, timeout_seconds=0.3).scan(b"data")
    assert result.status == ScanStatus.ERROR


async def test_clamav_connection_refused_is_error() -> None:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    result = await ClamAVScanner("127.0.0.1", port, timeout_seconds=2).scan(b"data")
    assert result.status == ScanStatus.ERROR


@pytest.mark.parametrize(("raw", "status", "signature"), [
    (b"stream: OK\0", ScanStatus.CLEAN, None),
    (b"stream: Eicar-Signature FOUND\0", ScanStatus.INFECTED, "Eicar-Signature"),
    (b"INSTREAM size limit exceeded. ERROR\0", ScanStatus.ERROR, None),
    (b"", ScanStatus.ERROR, None),
])
def test_parse_clamd_reply(raw: bytes, status: str, signature: str | None) -> None:
    result = parse_clamd_reply(raw)
    assert result.status == status and result.signature == signature


def test_build_scanner() -> None:
    assert isinstance(build_scanner(get_settings().model_copy(update={"malware_scanner": "none"})), NoopScanner)
    scanner = build_scanner(get_settings().model_copy(update={"malware_scanner": "clamav",
                                                              "clamav_host": "clamd", "clamav_port": 3310}))
    assert isinstance(scanner, ClamAVScanner) and scanner.host == "clamd" and scanner.port == 3310
