"""Memory API / tool / model-output schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.time import ensure_aware, utcnow
from app.memory.models import MemoryStatus, MemoryType

Freshness = Literal["fresh", "stale", "unverified"]

# Types a model (extraction) may propose. Short-lived/conversational memories are never extracted.
ExtractableType = Literal["preference", "long_term", "semantic", "verified_fact", "contact", "task_history"]


class RetrievedMemory(BaseModel):
    """A memory returned by retrieval, with the signals a consumer needs to weigh it.

    ``freshness`` is ``"unverified"`` for low-confidence or conflicted memories and ``"stale"``
    when the memory has not been re-verified within its type's maximum age: consumers must
    treat such memories as hints to confirm, never as ground truth.
    """

    id: uuid.UUID
    content: str
    memory_type: str
    confidence: float
    importance: float
    score: float
    freshness: Freshness
    source_type: str
    source_reference: str
    last_verified_at: datetime
    subject_key: str | None = None
    status: str = MemoryStatus.ACTIVE.value


class ContactCandidate(BaseModel):
    name: str
    email: str
    source: str = "memory"
    confidence: float
    memory_id: uuid.UUID


class MemoryOut(BaseModel):
    id: uuid.UUID
    content: str
    memory_type: str
    subject_key: str | None
    confidence: float
    importance: float
    source_type: str
    source_reference: str
    status: str
    superseded_by: uuid.UUID | None
    freshness: Freshness
    created_at: datetime
    updated_at: datetime
    last_verified_at: datetime
    expires_at: datetime | None
    last_accessed_at: datetime | None
    access_count: int


class MemoryCreate(BaseModel):
    """A memory the user states explicitly (highest trust: confidence 1.0)."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=2000)
    memory_type: MemoryType = MemoryType.LONG_TERM
    subject_key: str | None = Field(default=None, max_length=200,
                                    description="Optional normalized key for conflict detection, "
                                                "e.g. 'contact:rahim:email' or 'pref:meeting_length'")
    importance: float = Field(default=0.7, ge=0.0, le=1.0)
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _future(cls, value: datetime | None) -> datetime | None:
        if value is not None and ensure_aware(value) <= utcnow():
            raise ValueError("expires_at must be in the future")
        return value


class MemorySearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=8, ge=1, le=20)
    memory_types: list[MemoryType] | None = Field(default=None, max_length=8)


class MemorySearchResponse(BaseModel):
    results: list[RetrievedMemory]


# ---------------------------------------------------------------------------- model output (extraction)
class MemoryCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=3, max_length=500,
                         description="One self-contained fact about the user, in the third person")
    memory_type: ExtractableType
    subject_key: str | None = Field(default=None, max_length=200,
                                    description="Stable key such as 'contact:<name>:email' or 'pref:<topic>'")
    importance: float = Field(ge=0.0, le=1.0, description="How useful this is for future tasks")
    confidence: float = Field(ge=0.0, le=1.0, description="How certain it is that the user stated this")


class MemoryCandidates(BaseModel):
    model_config = ConfigDict(extra="forbid")

    memories: list[MemoryCandidate] = Field(default_factory=list, max_length=20)
