"""
Procedural Strategy Memory (Section 9) -- explicitly NOT ordinary chat
memory. Backed by SQLite for the MVP; the interface is deliberately storage
agnostic so PostgreSQL / Qdrant / OpenSearch implementations can be dropped
in later (Section 9) without touching any calling code.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from acbe.strategy.models import Strategy


class StrategyMemory(ABC):
    @abstractmethod
    async def store(self, strategy: Strategy) -> None:
        ...

    @abstractmethod
    async def update(self, strategy: Strategy) -> None:
        ...

    @abstractmethod
    async def get(self, strategy_id: str) -> Optional[Strategy]:
        ...

    @abstractmethod
    async def retrieve(
        self,
        failure_pattern: str,
        environment_id: Optional[str] = None,
        min_success_rate: float = 0.0,
        lifecycle: Optional[List[str]] = None,
    ) -> List[Strategy]:
        """Retrieve candidate strategies for a given failure pattern,
        optionally biased toward ones already validated in this
        environment. Used both for within-task recovery and for
        cross-task transfer (Section 10)."""

    @abstractmethod
    async def list_all(self) -> List[Strategy]:
        ...
