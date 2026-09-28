"""A tiny explicit success/failure container for domain operations that
should not use exceptions for expected outcomes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")
E = TypeVar("E")


@dataclass(frozen=True, slots=True)
class Ok(Generic[T]):
    value: T

    @property
    def ok(self) -> bool:
        return True


@dataclass(frozen=True, slots=True)
class Err(Generic[E]):
    error: E

    @property
    def ok(self) -> bool:
        return False


Result = Ok[T] | Err[E]
