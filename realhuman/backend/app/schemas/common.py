from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, PlainSerializer
from pydantic.alias_generators import to_camel


def to_iso(value: datetime) -> str:
    """`2026-09-25T12:00:00.123Z` — the only format `z.iso.datetime()` accepts by default."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    value = value.astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


UtcDatetime = Annotated[datetime, PlainSerializer(to_iso, return_type=str, when_used="json")]


class CamelModel(BaseModel):
    """JSON fields are camelCase; Python attributes stay snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# Mirrors zod v4's `z.email()` so anything the API accepts, the web app accepts too.
_EMAIL = re.compile(
    r"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$"
)


def _normalize_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 320 or not _EMAIL.match(value):
        raise ValueError("Enter a valid email address.")
    return value


Email = Annotated[str, AfterValidator(_normalize_email)]


def _strip(value: str) -> str:
    return value.strip()


def round_score(value: float) -> float:
    """Clamp to 0–1 and round half up to two decimals, like the web app's `roundScore`."""
    clamped = min(1.0, max(0.0, value))
    return int(clamped * 100 + 0.5) / 100
