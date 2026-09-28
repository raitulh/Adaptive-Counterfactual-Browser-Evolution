"""Stateful simulator of the Google Workspace REST endpoints AgentOS uses.

Used by the evaluation harness (and the test-suite) to exercise the *real*
adapters, tools, execution engine, verification and recovery code against a
deterministic environment with injectable failures:

* ``timeout`` / ``network`` before the effect (definitive: nothing happened);
* ``timeout`` *after* the effect (ambiguous: the write happened, the response was lost);
* HTTP status errors (401, 403 insufficient scope, 404, 409, 429, 500/503);
* tampering hooks that change stored state after a write (verification mismatch).

It speaks the same wire format as Google for the subset of fields AgentOS reads.
It is never wired into production configuration.
"""

from __future__ import annotations

import base64
import email
import itertools
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from email import policy as email_policy
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

import httpx


@dataclass
class Failure:
    kind: str  # "timeout" | "network" | "status"
    status: int = 500
    reason: str = ""
    times: int = 1
    after_effect: bool = False  # perform the operation, then fail (ambiguous outcome)


@dataclass
class FakeGoogleWorkspace:
    calendar_events: dict[str, dict[str, Any]] = field(default_factory=dict)
    busy: list[dict[str, str]] = field(default_factory=list)  # extra free/busy intervals
    messages: dict[str, dict[str, Any]] = field(default_factory=dict)
    drafts: dict[str, dict[str, Any]] = field(default_factory=dict)
    drive_files: dict[str, dict[str, Any]] = field(default_factory=dict)
    contacts: list[dict[str, Any]] = field(default_factory=list)
    valid_access_tokens: set[str] = field(default_factory=set)
    refresh_tokens: dict[str, str] = field(default_factory=dict)  # refresh token -> granted scope string
    revoked_refresh_tokens: set[str] = field(default_factory=set)
    failures: dict[str, list[Failure]] = field(default_factory=dict)
    event_tamper: Callable[[dict[str, Any]], None] | None = None
    calls: list[tuple[str, str]] = field(default_factory=list)
    _ids: Any = field(default_factory=lambda: itertools.count(1))

    # ------------------------------------------------------------------ setup helpers
    def issue_tokens(self, scopes: list[str]) -> tuple[str, str]:
        access = f"ya29.fake-{secrets.token_hex(8)}"
        refresh = f"1//fake-refresh-{secrets.token_hex(8)}"
        self.valid_access_tokens.add(access)
        self.refresh_tokens[refresh] = " ".join(scopes)
        return access, refresh

    def add_contact(self, name: str, email_address: str) -> None:
        self.contacts.append({"resourceName": f"people/c{next(self._ids)}",
                              "names": [{"displayName": name}],
                              "emailAddresses": [{"value": email_address}]})

    def add_busy(self, start: datetime, end: datetime) -> None:
        self.busy.append({"start": start.isoformat(), "end": end.isoformat()})

    def add_message(self, *, sender: str, to: str, subject: str, body: str, labels: list[str] | None = None) -> str:
        mid = f"m{next(self._ids)}"
        data = base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")
        self.messages[mid] = {
            "id": mid, "threadId": f"t{mid}", "labelIds": labels or ["INBOX", "UNREAD"],
            "snippet": body[:100],
            "payload": {"mimeType": "text/plain", "headers": [
                {"name": "From", "value": sender}, {"name": "To", "value": to}, {"name": "Subject", "value": subject},
                {"name": "Date", "value": "Mon, 28 Sep 2026 09:00:00 +0000"},
                {"name": "Message-ID", "value": f"<{mid}@example.com>"}], "body": {"data": data}},
        }
        return mid

    def fail(self, route: str, failure: Failure) -> None:
        self.failures.setdefault(route, []).append(failure)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    # ------------------------------------------------------------------ dispatch
    def _take_failure(self, route: str) -> Failure | None:
        queue = self.failures.get(route) or []
        if not queue:
            return None
        failure = queue[0]
        failure.times -= 1
        if failure.times <= 0:
            queue.pop(0)
        return failure

    @staticmethod
    def _raise_or_respond(failure: Failure, request: httpx.Request) -> httpx.Response:
        if failure.kind == "timeout":
            raise httpx.ReadTimeout("simulated timeout", request=request)
        if failure.kind == "network":
            raise httpx.ConnectError("simulated network failure", request=request)
        body: dict[str, Any] = {"error": {"code": failure.status, "status": failure.reason or "ERROR",
                                          "message": "simulated failure",
                                          "errors": [{"reason": failure.reason or "backendError"}]}}
        return httpx.Response(failure.status, json=body)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = urlsplit(str(request.url))
        path = unquote(url.path)
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        route, handler = self._route(request.method, url.netloc, path)
        self.calls.append((route, request.method))
        if route != "oauth.token" and route != "oauth.revoke":
            auth = request.headers.get("authorization", "")
            if not auth.startswith("Bearer ") or auth[7:] not in self.valid_access_tokens:
                return httpx.Response(401, json={"error": {"code": 401, "status": "UNAUTHENTICATED",
                                                           "message": "Invalid Credentials"}})
        failure = self._take_failure(route)
        if failure is not None and not failure.after_effect:
            return self._raise_or_respond(failure, request)
        response = handler(request, path, query)
        if failure is not None and failure.after_effect:
            return self._raise_or_respond(failure, request)
        return response

    def _route(self, method: str, host: str, path: str) -> tuple[str, Callable[..., httpx.Response]]:
        if host == "oauth2.googleapis.com":
            return ("oauth.token", self._token) if path == "/token" else ("oauth.revoke", self._revoke)
        if host == "www.googleapis.com" and path.startswith("/calendar/v3"):
            rest = path[len("/calendar/v3"):]
            if rest == "/freeBusy":
                return "calendar.freebusy", self._freebusy
            parts = rest.strip("/").split("/")  # calendars/{cid}/events[/{eid}]
            if len(parts) == 3:
                return ("calendar.list", self._list_events) if method == "GET" else ("calendar.insert",
                                                                                       self._insert_event)
            if len(parts) == 4:
                return {"GET": ("calendar.get", self._get_event), "PATCH": ("calendar.patch", self._patch_event),
                        "DELETE": ("calendar.delete", self._delete_event)}[method]
        if host == "gmail.googleapis.com":
            rest = path.split("/users/me", 1)[1]
            if rest == "/messages/send":
                return "gmail.send", self._send
            if rest == "/messages":
                return "gmail.list", self._list_messages
            if rest.startswith("/messages/"):
                return "gmail.get", self._get_message
            if rest == "/drafts" and method == "POST":
                return "gmail.draft_create", self._create_draft
            if rest == "/drafts":
                return "gmail.draft_list", self._list_drafts
            if rest.startswith("/drafts/"):
                return "gmail.draft_get", self._get_draft
        if host == "www.googleapis.com" and path.startswith("/drive/v3/files"):
            rest = path[len("/drive/v3/files"):]
            if rest == "":
                return "drive.list", self._drive_list
            if rest.endswith("/export"):
                return "drive.export", self._drive_content
            return "drive.get", self._drive_get
        if host == "people.googleapis.com":
            return "people.search", self._people_search
        return "unknown", lambda *_: httpx.Response(404, json={"error": {"code": 404, "message": "no route"}})

    # ------------------------------------------------------------------ oauth
    def _token(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        form = {k: v[-1] for k, v in parse_qs(request.content.decode()).items()}
        refresh = form.get("refresh_token", "")
        if form.get("grant_type") != "refresh_token" or refresh not in self.refresh_tokens \
                or refresh in self.revoked_refresh_tokens:
            return httpx.Response(400, json={"error": "invalid_grant",
                                             "error_description": "Token has been expired or revoked."})
        access = f"ya29.fake-{secrets.token_hex(8)}"
        self.valid_access_tokens.add(access)
        return httpx.Response(200, json={"access_token": access, "expires_in": 3599, "token_type": "Bearer",
                                         "scope": self.refresh_tokens[refresh]})

    def _revoke(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        form = {k: v[-1] for k, v in parse_qs(request.content.decode()).items()}
        self.revoked_refresh_tokens.add(form.get("token", ""))
        self.valid_access_tokens.discard(form.get("token", ""))
        return httpx.Response(200, json={})

    # ------------------------------------------------------------------ calendar
    def _list_events(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        tmin = datetime.fromisoformat(query["timeMin"].replace("Z", "+00:00"))
        tmax = datetime.fromisoformat(query["timeMax"].replace("Z", "+00:00"))
        items = [e for e in self.calendar_events.values()
                 if datetime.fromisoformat(e["start"]["dateTime"]) < tmax
                 and datetime.fromisoformat(e["end"]["dateTime"]) > tmin]
        return httpx.Response(200, json={"items": items})

    def _freebusy(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        body = json.loads(request.content)
        tmin = datetime.fromisoformat(body["timeMin"])
        tmax = datetime.fromisoformat(body["timeMax"])
        busy = [b for b in self.busy if datetime.fromisoformat(b["end"]) > tmin
                and datetime.fromisoformat(b["start"]) < tmax]
        busy += [{"start": e["start"]["dateTime"], "end": e["end"]["dateTime"]}
                 for e in self.calendar_events.values() if e.get("status") != "cancelled"
                 and datetime.fromisoformat(e["end"]["dateTime"]) > tmin
                 and datetime.fromisoformat(e["start"]["dateTime"]) < tmax]
        return httpx.Response(200, json={"calendars": {item["id"]: {"busy": busy} for item in body["items"]}})

    def _insert_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        body = json.loads(request.content)
        eid = body.get("id") or f"ev{next(self._ids)}"
        if eid in self.calendar_events:
            return httpx.Response(409, json={"error": {"code": 409, "status": "ALREADY_EXISTS",
                                                       "errors": [{"reason": "duplicate"}]}})
        event = {**body, "id": eid, "status": "confirmed", "etag": f'"{secrets.token_hex(4)}"',
                 "htmlLink": f"https://calendar.google.com/event?eid={eid}",
                 "attendees": [{"email": a["email"], "responseStatus": "needsAction"}
                               for a in body.get("attendees", [])]}
        self.calendar_events[eid] = event
        if self.event_tamper is not None:
            stored = json.loads(json.dumps(event))
            self.event_tamper(stored)
            self.calendar_events[eid] = stored
        return httpx.Response(200, json=event)

    def _event_id(self, path: str) -> str:
        return path.rstrip("/").split("/")[-1]

    def _get_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        event = self.calendar_events.get(self._event_id(path))
        if event is None:
            return httpx.Response(404, json={"error": {"code": 404, "status": "NOT_FOUND",
                                                       "errors": [{"reason": "notFound"}]}})
        return httpx.Response(200, json=event)

    def _patch_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        event = self.calendar_events.get(self._event_id(path))
        if event is None:
            return httpx.Response(404, json={"error": {"code": 404, "errors": [{"reason": "notFound"}]}})
        event.update(json.loads(request.content))
        return httpx.Response(200, json=event)

    def _delete_event(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        event = self.calendar_events.get(self._event_id(path))
        if event is None or event.get("status") == "cancelled":
            return httpx.Response(410, json={"error": {"code": 410, "errors": [{"reason": "deleted"}]}})
        event["status"] = "cancelled"
        return httpx.Response(204)

    # ------------------------------------------------------------------ gmail
    @staticmethod
    def _parse_raw(raw: str) -> tuple[list[dict[str, str]], str]:
        data = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        msg = email.message_from_bytes(data, policy=email_policy.default)
        headers = [{"name": k, "value": str(v)} for k, v in msg.items()]
        body = msg.get_body(preferencelist=("plain",))
        text = body.get_content() if body is not None else ""
        return headers, text

    def _store_message(self, raw: str, labels: list[str]) -> dict[str, Any]:
        headers, text = self._parse_raw(raw)
        mid = f"sent{next(self._ids)}"
        message = {"id": mid, "threadId": f"t{mid}", "labelIds": labels, "snippet": text[:100],
                   "payload": {"mimeType": "text/plain", "headers": headers,
                               "body": {"data": base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")}}}
        self.messages[mid] = message
        return message

    def _send(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        body = json.loads(request.content)
        headers, _ = self._parse_raw(body["raw"])
        recipients = " ".join(h["value"] for h in headers if h["name"].lower() in ("to", "cc", "bcc"))
        if "@" not in recipients or "invalid" in recipients:
            return httpx.Response(400, json={"error": {"code": 400, "status": "INVALID_ARGUMENT",
                                                       "message": "Invalid To header",
                                                       "errors": [{"reason": "invalidArgument"}]}})
        message = self._store_message(body["raw"], ["SENT"])
        return httpx.Response(200, json={"id": message["id"], "threadId": message["threadId"], "labelIds": ["SENT"]})

    def _list_messages(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        q = query.get("q", "")
        items = list(self.messages.values())
        if q.startswith("rfc822msgid:"):
            wanted = q.split(":", 1)[1].strip()
            items = [m for m in items if any(h["name"].lower() == "message-id" and h["value"].strip() == wanted
                                             for h in m["payload"]["headers"])]
        elif "in:inbox" in q:
            items = [m for m in items if "INBOX" in m["labelIds"]]
        limit = int(query.get("maxResults", 10))
        return httpx.Response(200, json={"messages": [{"id": m["id"], "threadId": m["threadId"]}
                                                      for m in items[:limit]]})

    def _get_message(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        message = self.messages.get(path.rstrip("/").split("/")[-1])
        if message is None:
            return httpx.Response(404, json={"error": {"code": 404, "errors": [{"reason": "notFound"}]}})
        return httpx.Response(200, json=message)

    def _create_draft(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        body = json.loads(request.content)
        message = self._store_message(body["message"]["raw"], ["DRAFT"])
        did = f"d{next(self._ids)}"
        self.drafts[did] = {"id": did, "message": message}
        return httpx.Response(200, json={"id": did, "message": {"id": message["id"]}})

    def _list_drafts(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        q = query.get("q", "")
        items = list(self.drafts.values())
        if q.startswith("rfc822msgid:"):
            wanted = q.split(":", 1)[1].strip()
            items = [d for d in items if any(h["name"].lower() == "message-id" and h["value"].strip() == wanted
                                             for h in d["message"]["payload"]["headers"])]
        return httpx.Response(200, json={"drafts": [{"id": d["id"], "message": {"id": d["message"]["id"]}}
                                                    for d in items]})

    def _get_draft(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        draft = self.drafts.get(path.rstrip("/").split("/")[-1])
        if draft is None:
            return httpx.Response(404, json={"error": {"code": 404, "errors": [{"reason": "notFound"}]}})
        return httpx.Response(200, json=draft)

    # ------------------------------------------------------------------ drive / people
    def _drive_list(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        return httpx.Response(200, json={"files": [{k: v for k, v in f.items() if k != "content"}
                                                   for f in self.drive_files.values()]})

    def _drive_get(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        fid = path.rstrip("/").split("/")[-1]
        f = self.drive_files.get(fid)
        if f is None:
            return httpx.Response(404, json={"error": {"code": 404, "errors": [{"reason": "notFound"}]}})
        if query.get("alt") == "media":
            return httpx.Response(200, content=f.get("content", "").encode())
        return httpx.Response(200, json={k: v for k, v in f.items() if k != "content"})

    def _drive_content(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        fid = path.rstrip("/").split("/")[-2]
        f = self.drive_files.get(fid)
        if f is None:
            return httpx.Response(404, json={"error": {"code": 404}})
        return httpx.Response(200, content=f.get("content", "").encode())

    def _people_search(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
        q = query.get("query", "").lower()
        results = [{"person": c} for c in self.contacts
                   if any(q in n["displayName"].lower() for n in c.get("names", []))]
        return httpx.Response(200, json={"results": results})
