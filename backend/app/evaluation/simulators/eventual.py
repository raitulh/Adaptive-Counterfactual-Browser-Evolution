"""Eventually-consistent variant of the Google Workspace simulator.

Real providers occasionally return 404 for a resource that was created a moment
ago (replication lag). ``LaggyGoogleWorkspace`` reproduces that for calendar
read-backs: the first ``read_lag`` GETs of each newly inserted event answer 404.
It is used by evaluation cases that measure read-back verification strategies
(``StrategyConfig.verification_readback``). Base simulator behaviour is unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.evaluation.simulators.google_workspace import FakeGoogleWorkspace


@dataclass
class LaggyGoogleWorkspace(FakeGoogleWorkspace):
    read_lag: int = 0
    _pending_reads: dict[str, int] = field(default_factory=dict)

    def _insert_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        response = super()._insert_event(request, path, query)
        if response.status_code == 200 and self.read_lag > 0:
            self._pending_reads[str(response.json()["id"])] = self.read_lag
        return response

    def _get_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        event_id = self._event_id(path)
        remaining = self._pending_reads.get(event_id, 0)
        if remaining > 0:
            self._pending_reads[event_id] = remaining - 1
            return httpx.Response(404, json={"error": {"code": 404, "status": "NOT_FOUND",
                                                       "errors": [{"reason": "notFound"}]}})
        return super()._get_event(request, path, query)
