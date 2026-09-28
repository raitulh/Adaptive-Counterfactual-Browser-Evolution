"""Shared type aliases and constrained primitive types."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import StringConstraints

JSON = dict[str, Any]
JSONValue = Any

NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ShortStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_-]{0,62}$")]
ToolName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$", max_length=128)]
IdempotencyKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_\-:.]{8,128}$")]
