"""Test helpers for the browser subsystem: a local web site on 127.0.0.1, a canary server
on 127.0.0.2 (any hit on it means the egress policy leaked), a fake object store and a
deterministic resolver."""

from __future__ import annotations

import asyncio
import socket
import threading
import uuid
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from app.browser.policy import BrowserEgressPolicy
from app.core.config import Settings
from app.security.ssrf import EgressPolicy

CANARY_HOST = "127.0.0.2"


def _page(title: str, body: str) -> bytes:
    return f"<!doctype html><html><head><title>{title}</title></head><body>{body}</body></html>".encode()


class LocalSite:
    """Threaded HTTP server with the pages the executor tests need."""

    def __init__(self) -> None:
        self.hits: list[str] = []
        self.canary_hits: list[str] = []
        self.submissions: list[dict[str, list[str]]] = []
        self._servers: list[ThreadingHTTPServer] = []
        self.port = 0
        self.canary_port = 0

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def canary(self) -> str:
        return f"http://{CANARY_HOST}:{self.canary_port}"

    def start(self) -> LocalSite:
        site = self

        class Main(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:
                site.hits.append(self.path)
                site.route(self)

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode()
                site.hits.append(self.path)
                site.submissions.append(parse_qs(body))
                self._send(200, _page("Saved", "<p>Your message was saved</p>"))

            def _send(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

        class Canary(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:
                site.canary_hits.append(self.path)
                body = b"canary"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        main = ThreadingHTTPServer(("127.0.0.1", 0), Main)
        canary = ThreadingHTTPServer((CANARY_HOST, 0), Canary)
        self._servers = [main, canary]
        self.port = main.server_port
        self.canary_port = canary.server_port
        for server in self._servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        for server in self._servers:
            server.shutdown()
            server.server_close()

    # ------------------------------------------------------------------ routes
    def route(self, h: Any) -> None:
        path = urlsplit(h.path).path
        query = parse_qs(urlsplit(h.path).query)
        pages: dict[str, Callable[[], None]] = {
            "/": lambda: h._send(200, _page("Home", """
                <h1>Welcome</h1>
                <form action="/submit" method="get">
                  <label for="q">Query</label><input id="q" name="q">
                  <select name="color" aria-label="Color"><option value="red">Red</option>
                    <option value="blue">Blue</option></select>
                  <button type="submit">Search</button>
                </form>
                <button>Dup</button><button>Dup</button>
                <div data-testid="promo">Promo text</div>
                <p id="para">Paragraph text</p>""")),
            "/submit": lambda: h._send(200, _page("Results", f"<p>Results for {query.get('q', [''])[0]}</p>"
                                                               f"<p>Color {query.get('color', [''])[0]}</p>")),
            "/post-form": lambda: h._send(200, _page("Post", """
                <form action="/save" method="post"><label for="m">Message</label><input id="m" name="m">
                <button type="submit">Save</button></form>""")),
            "/set-state": lambda: h._send(200, _page("Set", """
                <script>localStorage.setItem('secret', 'value1'); sessionStorage.setItem('s', 'v');
                document.cookie = 'jsc=1; path=/';</script><p>state set</p>"""),
                {"Set-Cookie": "session=abc123; Path=/"}),
            "/check-state": lambda: h._send(200, _page("Check", """
                <p id="out">pending</p><script>
                document.getElementById('out').textContent = 'cookie=[' + document.cookie + '] storage=[' +
                  (localStorage.getItem('secret') || '') + ']';</script>""")),
            "/redir-private": lambda: h._send(302, b"", {"Location": f"{self.canary}/redirected"}),
            "/redir-metadata": lambda: h._send(302, b"", {"Location": "http://169.254.169.254/latest/meta-data/"}),
            "/subrequests": lambda: h._send(200, _page("Subrequests", f"""
                <p>Loaded</p>
                <img src="{self.canary}/img.png">
                <img src="http://10.1.2.3/x.png">
                <img src="http://169.254.169.254/latest/meta-data/">
                <img src="file:///etc/passwd">
                <iframe src="{self.canary}/frame"></iframe>
                <script>fetch("{self.canary}/fetch").catch(() => {{}});
                  fetch("http://127.0.0.1:{self.port}/api-ok").catch(() => {{}});</script>""")),
            "/file-probe": lambda: h._send(200, _page("Probe", """
                <iframe src="file:///etc/passwd"></iframe>
                <a id="local" href="file:///etc/passwd">local file</a>
                <p id="leak">none</p>
                <script>fetch("file:///etc/passwd").then(r => r.text())
                  .then(t => { document.getElementById("leak").textContent = t; }).catch(() => {});</script>""")),
            "/api-ok": lambda: h._send(200, b"ok"),
            "/echo-host": lambda: h._send(200, str(h.headers.get("Host")).encode()),
            "/dl-page": lambda: h._send(200, _page("Downloads", '<a id="dl" href="/download">Get file</a>')),
            "/download": lambda: h._send(200, b"secret-bytes", {"Content-Disposition": "attachment; filename=x.bin",
                                                                "Content-Type": "application/octet-stream"}),
            "/popup": lambda: h._send(200, _page("Popup", """
                <button onclick="window.open('/submit?q=popup', '_blank')">Open</button>""")),
            "/dialog": lambda: h._send(200, _page("Dialog", """
                <button onclick="alert('hi'); document.getElementById('r').textContent = 'after alert'">Alert</button>
                <p id="r">before</p>""")),
            "/upload": lambda: h._send(200, _page("Upload", '<label for="f">File</label><input type="file" id="f">')),
            "/slow-text": lambda: h._send(200, _page("Slow", "<p>Nothing here</p>")),
            "/big": lambda: h._send(200, _page("Big", "<p>" + ("word " * 20000) + "</p>")),
        }
        handler = pages.get(path)
        if handler is None:
            h._send(404, _page("Not found", "<p>missing</p>"))
        else:
            handler()


class FakeStorage:
    def __init__(self, *, fail: bool = False) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.deleted: list[str] = []
        self.fail = fail

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        if self.fail:
            raise OSError("storage down")
        self.objects[key] = (data, content_type)

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


def local_policy(site: LocalSite) -> BrowserEgressPolicy:
    """Dev-style policy: private networks allowed (the local test site) on the test ports."""
    return BrowserEgressPolicy(EgressPolicy(allow_private_network=True, allowed_ports={site.port}))


def trusted_host_policy(site: LocalSite) -> BrowserEgressPolicy:
    """Private networks blocked; only the test site's host is trusted. The canary (127.0.0.2)
    is on an allowed port, so any block of it is due to the private-address rule."""
    return BrowserEgressPolicy(EgressPolicy(allow_private_network=False, trusted_private_hosts=["127.0.0.1"],
                                            allowed_ports={80, 443, site.port, site.canary_port}))


def install_resolver(monkeypatch: Any, mapping: dict[str, str]) -> list[str]:
    """Deterministic DNS for the running loop; returns the list of looked-up hosts."""
    loop = asyncio.get_running_loop()
    lookups: list[str] = []

    async def fake_getaddrinfo(host: str, port: int, *args: Any, **kwargs: Any) -> list[Any]:
        lookups.append(host)
        if host not in mapping:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (mapping[host], port))]

    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
    return lookups


def new_ids() -> tuple[uuid.UUID, uuid.UUID]:
    return uuid.uuid4(), uuid.uuid4()


def executor_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"browser_task_timeout_seconds": 30, "browser_action_timeout_ms": 4_000,
                              "browser_max_actions": 12, "browser_max_concurrency": 2,
                              "browser_allow_downloads": False}
    values.update(overrides)
    return Settings(**values)
