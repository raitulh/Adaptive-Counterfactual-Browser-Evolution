"""Fixtures for browser unit tests (local web site, fake storage, a real Chromium executor)."""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from browser_testkit import FakeStorage, LocalSite, executor_settings  # noqa: E402


@pytest.fixture(scope="session")
def site() -> Iterator[LocalSite]:
    server = LocalSite().start()
    yield server
    server.stop()


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def executor_pair() -> AsyncIterator[tuple[Any, FakeStorage]]:
    """One Chromium per test module (contexts are still fresh per run)."""
    from app.browser.executor import BrowserExecutor

    store = FakeStorage()
    executor = BrowserExecutor(executor_settings(), store, no_sandbox=os.geteuid() == 0)
    yield executor, store
    await executor.aclose()
