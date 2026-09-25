from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, Email


class ContactIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    email: Email
    company: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)

    @field_validator("name", "company", "message", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ContactOut(CamelModel):
    received: Literal[True] = True
