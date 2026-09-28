"""search ORM models: indexed documents (web results, file extracts) and their chunks."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Computed, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin

EMBEDDING_DIMENSIONS = 768


class SourceType:
    WEB = "web"
    FILE = "file"


class SearchDocument(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    __tablename__ = "search_documents"

    # Owner for private sources (files, a user's web searches); NULL = shared within the tenant.
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"),
                                                      nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # File id, or SHA-256 of the canonical URL for web documents.
    source_id: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "source_type", "source_id"),
        Index("ix_search_documents_tenant_user_source", "tenant_id", "user_id", "source_type"),
    )


class SearchChunk(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    __tablename__ = "search_chunks"

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("search_documents.id", ondelete="CASCADE"),
                                                   nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Offsets of ``content`` within the extracted source text (lets readers stitch overlapping chunks).
    char_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', coalesce(content, ''))", persisted=True), nullable=True
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index"),
        Index("ix_search_chunks_search_vector", "search_vector", postgresql_using="gin"),
        Index(
            "ix_search_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
