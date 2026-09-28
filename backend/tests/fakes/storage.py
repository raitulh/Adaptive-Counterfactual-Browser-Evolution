"""In-memory ObjectStorage for tests."""

from __future__ import annotations


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def get_bytes(self, key: str) -> bytes:
        return self.objects[key][0]

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def exists(self, key: str) -> bool:
        return key in self.objects

    async def signed_download_url(self, key: str, *, filename: str, ttl_seconds: int) -> str:
        return f"memory://{key}?filename={filename}"
