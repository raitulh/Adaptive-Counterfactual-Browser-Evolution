"""
Browser / computer-use abstraction (Section 3 of the spec).

Concrete backends implement this interface:

- ``MockBrowserAdapter``      -- deterministic in-memory simulator used for
                                  unit tests, CI, and the bundled benchmark.
                                  This *is* one of the backends the spec asks
                                  for ("sandbox browser").
- ``PlaywrightBrowserAdapter`` -- real Chromium automation via Playwright.

Future backends (Selenium, raw CDP, a desktop computer-use backend, a remote
browser pool) only need to implement this same interface to plug into every
other ACBE component unchanged.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from acbe.core.types import ActionRecord, VerificationResult


@dataclass
class RawBrowserState:
    """The full-fidelity state a backend can produce.

    Nothing downstream should assume every field is populated -- a headless
    text-only backend might only ever fill ``dom`` for instance.
    """

    url: str
    page_type: str = "unknown"
    dom: Optional[str] = None
    accessibility_tree: Optional[List[Dict[str, Any]]] = None
    screenshot_b64: Optional[str] = None
    elements: List[Dict[str, Any]] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)


class BrowserAdapter(ABC):
    """Abstract backend. All methods are async so real network/browser I/O
    (Playwright, remote CDP, ...) fits naturally; the mock backend simply
    resolves immediately.
    """

    name: str = "base"

    @abstractmethod
    async def start(self) -> None:
        ...

    @abstractmethod
    async def close(self) -> None:
        ...

    @abstractmethod
    async def observe(self) -> RawBrowserState:
        """Return the raw state of the current page/screen."""

    @abstractmethod
    async def act(self, action: ActionRecord) -> RawBrowserState:
        """Execute an action and return the resulting raw state.

        Implementations MUST NOT silently swallow failures: if the action
        cannot be resolved/executed, raise ``BrowserActionError`` so the
        failure pipeline can fingerprint it.
        """

    @abstractmethod
    async def verify(self, expected_state: str) -> VerificationResult:
        """Compare current state against an expectation string/spec."""

    async def screenshot(self) -> Optional[str]:
        return None

    async def __aenter__(self) -> "BrowserAdapter":
        await self.start()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()


class BrowserActionError(Exception):
    """Raised when an action fails to execute or resolves to the wrong
    element/target. Carries enough context for failure fingerprinting."""

    def __init__(self, message: str, *, expected_state: str = "", actual_state: str = "",
                 error_kind: str = "TOOL_FAILURE"):
        super().__init__(message)
        self.expected_state = expected_state
        self.actual_state = actual_state
        self.error_kind = error_kind
