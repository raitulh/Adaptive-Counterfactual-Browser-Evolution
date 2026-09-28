"""Google Workspace REST adapters (Calendar, Gmail, Drive, People).

Adapters translate HTTP/provider details into typed integration errors so no
Google-specific status codes or payload quirks leak into domain modules:

    401 → refresh once, then IntegrationExpired
    403 insufficient scope → InsufficientScope; 403 rate limit → IntegrationRateLimited
    404 → IntegrationNotFound   409 → IntegrationConflict   400 → IntegrationBadRequest
    429 → IntegrationRateLimited   5xx → IntegrationUnavailable   timeout → IntegrationTimeout
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from app.common.enums import ErrorClass
from app.core.exceptions import (
    InsufficientScope,
    IntegrationBadRequest,
    IntegrationConflict,
    IntegrationError,
    IntegrationExpired,
    IntegrationNotFound,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
)

logger = logging.getLogger(__name__)

CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
DRIVE_BASE = "https://www.googleapis.com/drive/v3"
PEOPLE_BASE = "https://people.googleapis.com/v1"

# token_provider(force_refresh) -> access token
TokenProvider = Callable[[bool], Awaitable[str]]


class GoogleApiClient:
    def __init__(self, token_provider: TokenProvider, http: httpx.AsyncClient, *, timeout: float = 20.0) -> None:
        self._token = token_provider
        self._http = http
        self._timeout = timeout

    async def request(self, method: str, url: str, *, params: dict[str, Any] | None = None,
                      json: Any = None, content: bytes | None = None, headers: dict[str, str] | None = None,
                      expect_json: bool = True) -> Any:
        for attempt in (0, 1):
            token = await self._token(attempt == 1)
            req_headers = {"Authorization": f"Bearer {token}", **(headers or {})}
            try:
                response = await self._http.request(method, url, params=params, json=json, content=content,
                                                    headers=req_headers, timeout=self._timeout)
            except httpx.TimeoutException as exc:
                raise IntegrationTimeout(provider="google") from exc
            except httpx.HTTPError as exc:
                raise IntegrationUnavailable("Google API unreachable", provider="google",
                                             error_class=ErrorClass.NETWORK_ERROR) from exc
            if response.status_code == 401 and attempt == 0:
                continue  # access token may have been revoked/rotated early: refresh once
            _raise_for_google_error(response)
            if response.status_code == 204 or not expect_json:
                return response.content if not expect_json else {}
            try:
                return response.json()
            except ValueError as exc:
                raise IntegrationError("Google returned a non-JSON response", provider="google",
                                       error_class=ErrorClass.UNKNOWN_OUTCOME) from exc
        raise IntegrationExpired(provider="google")  # pragma: no cover - loop exits via raise


def _google_reason(response: httpx.Response) -> tuple[str, str]:
    try:
        err = response.json().get("error", {})
    except ValueError:
        return "", ""
    if isinstance(err, str):
        return err, ""
    reasons = [e.get("reason", "") for e in err.get("errors", []) if isinstance(e, dict)]
    details = [d.get("reason", "") for d in err.get("details", []) if isinstance(d, dict)]
    return " ".join(reasons + details + [str(err.get("status", ""))]), str(err.get("message", ""))[:300]


def _raise_for_google_error(response: httpx.Response) -> None:
    status = response.status_code
    if status < 400:
        return
    reason, message = _google_reason(response)
    details = {"status": status, "reason": reason[:200]}
    if status == 401:
        raise IntegrationExpired("Google rejected the access token", provider="google", details=details)
    if status == 403:
        lowered = reason.lower()
        if "insufficient" in lowered or "scope" in lowered:
            raise InsufficientScope(provider="google", details=details)
        if "ratelimit" in lowered or "quota" in lowered:
            raise IntegrationRateLimited(provider="google", details=details)
        raise IntegrationError("Google denied access to this resource", provider="google", details=details,
                               error_class=ErrorClass.PERMISSION_DENIED, status=status)
    if status == 404 or status == 410:
        raise IntegrationNotFound(provider="google", details=details)
    if status == 409:
        raise IntegrationConflict(provider="google", details=details)
    if status == 429:
        raise IntegrationRateLimited(provider="google", details=details)
    if status >= 500:
        raise IntegrationUnavailable(provider="google", details=details, status=status)
    raise IntegrationBadRequest(message or "Google rejected the request", provider="google", details=details)


class CalendarAdapter:
    def __init__(self, client: GoogleApiClient) -> None:
        self.c = client

    async def list_events(self, *, calendar_id: str, time_min: str, time_max: str, max_results: int = 50,
                          query: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"timeMin": time_min, "timeMax": time_max, "singleEvents": "true",
                                  "orderBy": "startTime", "maxResults": max_results}
        if query:
            params["q"] = query
        data = await self.c.request("GET", f"{CALENDAR_BASE}/calendars/{quote(calendar_id, safe='')}/events",
                                    params=params)
        return list(data.get("items", []))

    async def freebusy(self, *, time_min: str, time_max: str, timezone: str, calendar_ids: list[str]
                       ) -> dict[str, list[dict[str, str]]]:
        data = await self.c.request("POST", f"{CALENDAR_BASE}/freeBusy", json={
            "timeMin": time_min, "timeMax": time_max, "timeZone": timezone,
            "items": [{"id": cid} for cid in calendar_ids]})
        out: dict[str, list[dict[str, str]]] = {}
        for cid, info in (data.get("calendars") or {}).items():
            if info.get("errors"):
                raise IntegrationError("Calendar free/busy lookup failed", provider="google",
                                       details={"calendar": cid, "errors": info["errors"][:3]})
            out[cid] = list(info.get("busy", []))
        return out

    async def insert_event(self, *, calendar_id: str, body: dict[str, Any], send_updates: str) -> dict[str, Any]:
        return dict(await self.c.request(
            "POST", f"{CALENDAR_BASE}/calendars/{quote(calendar_id, safe='')}/events",
            params={"sendUpdates": send_updates}, json=body))

    async def get_event(self, *, calendar_id: str, event_id: str) -> dict[str, Any]:
        return dict(await self.c.request(
            "GET", f"{CALENDAR_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}"))

    async def patch_event(self, *, calendar_id: str, event_id: str, body: dict[str, Any], send_updates: str
                          ) -> dict[str, Any]:
        return dict(await self.c.request(
            "PATCH", f"{CALENDAR_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}",
            params={"sendUpdates": send_updates}, json=body))

    async def delete_event(self, *, calendar_id: str, event_id: str, send_updates: str) -> None:
        await self.c.request(
            "DELETE", f"{CALENDAR_BASE}/calendars/{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}",
            params={"sendUpdates": send_updates})


class GmailAdapter:
    def __init__(self, client: GoogleApiClient) -> None:
        self.c = client

    async def list_messages(self, *, query: str, max_results: int = 10, label_ids: list[str] | None = None
                            ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": query, "maxResults": max_results}
        if label_ids:
            params["labelIds"] = label_ids
        data = await self.c.request("GET", f"{GMAIL_BASE}/messages", params=params)
        return list(data.get("messages", []))

    async def get_message(self, message_id: str, *, fmt: str = "full",
                          metadata_headers: list[str] | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"format": fmt}
        if metadata_headers:
            params["metadataHeaders"] = metadata_headers
        return dict(await self.c.request("GET", f"{GMAIL_BASE}/messages/{quote(message_id, safe='')}",
                                         params=params))

    async def send_raw(self, raw_rfc822: bytes) -> dict[str, Any]:
        raw = base64.urlsafe_b64encode(raw_rfc822).decode().rstrip("=")
        return dict(await self.c.request("POST", f"{GMAIL_BASE}/messages/send", json={"raw": raw}))

    async def create_draft(self, raw_rfc822: bytes) -> dict[str, Any]:
        raw = base64.urlsafe_b64encode(raw_rfc822).decode().rstrip("=")
        return dict(await self.c.request("POST", f"{GMAIL_BASE}/drafts", json={"message": {"raw": raw}}))

    async def list_drafts(self, *, query: str, max_results: int = 5) -> list[dict[str, Any]]:
        data = await self.c.request("GET", f"{GMAIL_BASE}/drafts", params={"q": query, "maxResults": max_results})
        return list(data.get("drafts", []))

    async def get_draft(self, draft_id: str) -> dict[str, Any]:
        return dict(await self.c.request("GET", f"{GMAIL_BASE}/drafts/{quote(draft_id, safe='')}",
                                         params={"format": "metadata"}))

    async def find_by_message_id_header(self, message_id_header: str) -> list[dict[str, Any]]:
        """Look up a message by its RFC 822 Message-ID (used for send reconciliation)."""
        return await self.list_messages(query=f"rfc822msgid:{message_id_header}", max_results=5)


class DriveAdapter:
    MAX_EXPORT_BYTES = 2 * 1024 * 1024

    def __init__(self, client: GoogleApiClient) -> None:
        self.c = client

    async def search(self, *, query: str | None, page_size: int = 20) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "pageSize": page_size, "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress))",
            "q": "trashed = false" + (f" and fullText contains '{_drive_escape(query)}'" if query else ""),
        }
        data = await self.c.request("GET", f"{DRIVE_BASE}/files", params=params)
        return list(data.get("files", []))

    async def get_metadata(self, file_id: str) -> dict[str, Any]:
        return dict(await self.c.request("GET", f"{DRIVE_BASE}/files/{quote(file_id, safe='')}",
                                         params={"fields": "id,name,mimeType,modifiedTime,size,md5Checksum"}))

    async def read_text(self, file_id: str, mime_type: str) -> bytes:
        if mime_type.startswith("application/vnd.google-apps."):
            export = "text/csv" if mime_type.endswith("spreadsheet") else "text/plain"
            content = await self.c.request("GET", f"{DRIVE_BASE}/files/{quote(file_id, safe='')}/export",
                                           params={"mimeType": export}, expect_json=False)
        else:
            content = await self.c.request("GET", f"{DRIVE_BASE}/files/{quote(file_id, safe='')}",
                                           params={"alt": "media"}, expect_json=False)
        return bytes(content)[: self.MAX_EXPORT_BYTES]


def _drive_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")[:200]


class PeopleAdapter:
    def __init__(self, client: GoogleApiClient) -> None:
        self.c = client

    async def search_contacts(self, query: str, page_size: int = 10) -> list[dict[str, Any]]:
        data = await self.c.request("GET", f"{PEOPLE_BASE}/people:searchContacts",
                                    params={"query": query, "pageSize": page_size,
                                            "readMask": "names,emailAddresses"})
        return [r.get("person", {}) for r in data.get("results", [])]
