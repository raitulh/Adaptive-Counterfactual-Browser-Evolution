"""search API / tool schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WebSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=400)
    max_results: int = Field(default=10, ge=1, le=20)


class Citation(BaseModel):
    source_url: str
    title: str
    provider: str
    retrieved_at: datetime
    relevance: float


class WebSearchHit(BaseModel):
    rank: int
    title: str
    url: str
    snippet: str
    provider: str
    provider_rank: int
    relevance: float = Field(description="0..1 blend of provider rank and query-term overlap")
    retrieved_at: datetime
    published_at: datetime | None = None
    document_id: uuid.UUID | None = None
    citation: Citation


class WebSearchResponse(BaseModel):
    query: str
    provider: str
    retrieved_at: datetime
    results: list[WebSearchHit]


class DocumentSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=400)
    limit: int = Field(default=10, ge=1, le=50)


class DocumentSearchHit(BaseModel):
    document_id: uuid.UUID
    chunk_id: uuid.UUID
    source_type: str
    source_id: str
    title: str
    url: str | None = None
    chunk_index: int
    content: str
    score: float
    keyword_score: float | None = None
    vector_score: float | None = None


class DocumentSearchResponse(BaseModel):
    query: str
    used_vector_search: bool
    results: list[DocumentSearchHit]


class FetchedPage(BaseModel):
    url: str
    final_url: str
    status_code: int
    content_type: str
    title: str | None = None
    text: str
    truncated: bool = False
    content_sha256: str
    retrieved_at: datetime
