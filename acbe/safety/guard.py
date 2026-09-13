from __future__ import annotations

import json
import time
from collections import deque
from pathlib import Path
from typing import Deque, Dict, List, Optional

from acbe.core.config import ACBEConfig
from acbe.core.types import now_ts


class ProtectedComponentError(PermissionError):
    """Raised when code evolution (or anything else) tries to touch a
    component the spec forbids modifying without explicit human sign-off."""


class DestructiveActionError(PermissionError):
    """Raised when an unconfirmed destructive/sensitive action is attempted."""


class DomainNotAllowedError(PermissionError):
    """Raised when navigation targets a domain outside the allowlist."""


class RateLimiter:
    """Simple in-memory sliding-window limiter. No Redis required for MVP,
    matching Section 19 ("do not require these for the basic installation")."""

    def __init__(self, max_events: int, window_seconds: float):
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: Dict[str, Deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.time()
        bucket = self._events.setdefault(key, deque())
        while bucket and now - bucket[0] > self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.max_events:
            return False
        bucket.append(now)
        return True


class SafetyGuard:
    def __init__(self, config: Optional[ACBEConfig] = None, audit_log_path: Optional[str] = None):
        self.config = config or ACBEConfig()
        self.audit_log_path = audit_log_path
        self._audit_entries: List[dict] = []
        self._rate_limiter = RateLimiter(max_events=60, window_seconds=60.0)

    # -- protected components (Sections 11, 27) ---------------------------
    def check_protected_component(self, component_name: str, *, human_approved: bool = False) -> None:
        if component_name in self.config.protected_components and not human_approved:
            self._log("protected_component_blocked", {"component": component_name})
            raise ProtectedComponentError(
                f"'{component_name}' is a protected component and cannot be modified "
                "without explicit human approval."
            )
        self._log("protected_component_change", {"component": component_name, "human_approved": human_approved})

    # -- destructive / sensitive actions -----------------------------------
    def check_destructive_action(self, operation: str, *, confirmed: bool = False) -> None:
        if operation in self.config.require_confirmation_for and not confirmed:
            self._log("destructive_action_blocked", {"operation": operation})
            raise DestructiveActionError(
                f"Operation '{operation}' requires explicit confirmation before it can run."
            )
        self._log("destructive_action_confirmed", {"operation": operation})

    # -- domain allowlist ----------------------------------------------------
    def check_domain(self, url: str) -> None:
        allowlist = self.config.domain_allowlist
        if allowlist and not any(domain in url for domain in allowlist):
            self._log("domain_blocked", {"url": url})
            raise DomainNotAllowedError(f"'{url}' is not in the configured domain allowlist.")

    # -- rate limiting ---------------------------------------------------------
    def check_rate_limit(self, key: str) -> None:
        if not self._rate_limiter.allow(key):
            self._log("rate_limited", {"key": key})
            raise RuntimeError(f"Rate limit exceeded for '{key}'.")

    # -- audit log -----------------------------------------------------------
    def _log(self, event: str, detail: dict) -> None:
        entry = {"timestamp": now_ts(), "event": event, "detail": detail}
        self._audit_entries.append(entry)
        if self.audit_log_path:
            Path(self.audit_log_path).parent.mkdir(parents=True, exist_ok=True)
            with open(self.audit_log_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry) + "\n")

    def audit_trail(self) -> List[dict]:
        return list(self._audit_entries)
