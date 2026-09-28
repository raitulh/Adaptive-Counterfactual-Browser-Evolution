"""Streaming upload cap and retention expiry rules."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import get_settings
from app.core.exceptions import PayloadTooLarge
from app.files.models import FilePurpose
from app.files.service import expiry_for, read_upload


class EndlessUpload:
    """An upload whose size is unknown up front and that never ends on its own."""

    def __init__(self) -> None:
        self.reads = 0

    async def read(self, size: int = -1) -> bytes:
        self.reads += 1
        return b"x" * size


class FiniteUpload:
    def __init__(self, data: bytes) -> None:
        self.data = data

    async def read(self, size: int = -1) -> bytes:
        chunk, self.data = self.data[:size], self.data[size:]
        return chunk


async def test_streaming_cap_stops_reading_early() -> None:
    upload = EndlessUpload()
    with pytest.raises(PayloadTooLarge) as exc:
        await read_upload(upload, 3 * 1024 * 1024)
    assert upload.reads == 4, "reading stops as soon as the cap is exceeded"
    assert exc.value.status_code == 413 and exc.value.details["max_bytes"] == 3 * 1024 * 1024


async def test_declared_size_rejected_without_reading() -> None:
    upload = EndlessUpload()
    with pytest.raises(PayloadTooLarge):
        await read_upload(upload, 100, declared_size=101)
    assert upload.reads == 0


async def test_within_cap_returns_all_bytes() -> None:
    data = b"abc" * 1_000_000
    assert await read_upload(FiniteUpload(data), len(data)) == data
    with pytest.raises(PayloadTooLarge):
        await read_upload(FiniteUpload(data + b"!"), len(data))


def test_expiry_rules() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    settings = get_settings()
    assert expiry_for(FilePurpose.USER_UPLOAD, now) is None
    assert expiry_for(FilePurpose.TASK_ARTIFACT, now) is None
    assert expiry_for(FilePurpose.TEMP, now) == now + timedelta(days=settings.retention_temp_files_days)
    assert expiry_for(FilePurpose.BROWSER_ARTIFACT, now) == now + timedelta(
        days=settings.retention_browser_artifacts_days)
