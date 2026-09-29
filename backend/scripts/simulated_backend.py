"""Run the REAL AgentOS API + worker against SIMULATED providers — for local UI development and
end-to-end tests of the web app. Never for production (refuses staging/production).

    python scripts/simulated_backend.py [--port 8000] [--latency-ms 350]

What is real: the FastAPI app, auth, RBAC, planner validation, permission engine, approvals,
execution engine, verification, recovery, reconciliation, audit, usage, SSE, job queue, outbox.
What is simulated:
  * the model: a scripted planner turns goals into realistic plans (see SCENARIOS below);
  * Google Workspace: the in-process simulator used by the evaluation suites (Calendar, Gmail,
    Contacts, Drive), including a local OAuth consent page, so "Connect Google" and "Sign in with
    Google" work end to end without network access or credentials.

Goal → scenario (case-insensitive keywords in the goal):
  "meeting" / "schedule" / "calendar"  find slot → contact → create event (approval) → e-mail (approval)
      "... with <Name> ..." picks the contact; an unknown name (e.g. "Zoe") asks you for the address
  "flaky"                               the first calendar calls fail (503) → retries → failed → resume works
  "draft"                               contact → Gmail draft (write, verified by read-back)
  "email" / "send"                      contact → Gmail send (approval)
  "inbox" / "unread"                    Gmail search (read-only)
  "remember"                            saves a memory
  "clarify" or a goal of 1–2 words      the planner asks a question first (waiting_input)
  anything else                         a direct answer (no tools; not externally verified)
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import secrets
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("GOOGLE_CLIENT_ID", "simulated-client.apps.googleusercontent.com")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "simulated-secret")
os.environ.setdefault("MODEL_PROVIDER", "scripted")

import httpx  # noqa: E402
import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

CONTACTS = [
    ("Rahim Uddin", "rahim@example.org"),
    ("Sara Chen", "sara.chen@example.com"),
    ("Omar Haddad", "omar@example.net"),
    ("Priya Nair", "priya.nair@example.com"),
]


# --------------------------------------------------------------------------- Google simulator
def build_google(latency_s: float) -> tuple[Any, httpx.AsyncClient]:
    from app.evaluation.simulators.google_workspace import FakeGoogleWorkspace

    class SimulatedGoogle(FakeGoogleWorkspace):
        """Adds the authorization-code grant, ID tokens and JWKS to the evaluation simulator."""

        def __post_init__(self) -> None:
            self.codes: dict[str, dict[str, str]] = {}
            self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        def issue_code(self, scope: str, email: str, nonce: str | None) -> str:
            code = f"sim-code-{secrets.token_urlsafe(12)}"
            self.codes[code] = {"scope": scope, "email": email, "nonce": nonce or ""}
            return code

        def id_token(self, email: str, nonce: str) -> str:
            from app.core.config import get_settings

            now = int(time.time())
            claims = {"iss": "https://accounts.google.com", "aud": get_settings().google_client_id,
                      "sub": f"sim-{uuid.uuid5(uuid.NAMESPACE_URL, email).hex[:20]}", "email": email,
                      "email_verified": True, "name": email.split("@")[0].replace(".", " ").title(),
                      "iat": now, "exp": now + 3600}
            if nonce:
                claims["nonce"] = nonce
            return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "sim-key"})

        def _token(self, request: httpx.Request, path: str, query: dict[str, str]) -> httpx.Response:
            form = {k: v[-1] for k, v in parse_qs(request.content.decode()).items()}
            if form.get("grant_type") == "authorization_code":
                grant = self.codes.pop(form.get("code", ""), None)
                if grant is None:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                scopes = grant["scope"].split()
                access, refresh = self.issue_tokens(scopes)
                body: dict[str, Any] = {"access_token": access, "refresh_token": refresh, "expires_in": 3599,
                                        "token_type": "Bearer", "scope": " ".join(scopes)}
                if "openid" in scopes:
                    body["id_token"] = self.id_token(grant["email"], grant["nonce"])
                return httpx.Response(200, json=body)
            return super()._token(request, path, query)

    google = SimulatedGoogle()
    google.__post_init__()
    for name, email in CONTACTS:
        google.add_contact(name, email)
    inner = google.transport()

    class SimTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == "www.googleapis.com" and request.url.path == "/oauth2/v3/certs":
                key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(google.key.public_key()))
                return httpx.Response(200, json={"keys": [{**key, "kid": "sim-key", "alg": "RS256", "use": "sig"}]})
            if latency_s:
                await asyncio.sleep(latency_s)
            await request.aread()
            return inner.handle_request(request)

    return google, httpx.AsyncClient(transport=SimTransport())


def seed_calendar(google: Any) -> None:
    """Busy blocks tomorrow 14:00–15:00 (UTC and the common demo time zones)."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    for tz in ("UTC", "Asia/Dhaka", "America/New_York", "Europe/London"):
        day = datetime.now(ZoneInfo(tz)).date() + timedelta(days=1)
        google.add_busy(datetime(day.year, day.month, day.day, 14, tzinfo=ZoneInfo(tz)),
                        datetime(day.year, day.month, day.day, 15, tzinfo=ZoneInfo(tz)))


# --------------------------------------------------------------------------- scripted planner
_INSTRUCTION = re.compile(r"<user_instruction>\s*(.*?)\s*</user_instruction>", re.S)


def extract_goal(request: Any) -> tuple[str, str]:
    text = "\n".join(m.text for m in request.messages)
    match = _INSTRUCTION.search(text)
    block = match.group(1) if match else text
    goal, _, answers = block.partition("\n")
    return goal.strip(), answers.strip()


def contact_name(goal: str) -> str:
    match = re.search(r"\b(?:with|to|email|e-mail)\s+([A-Z][a-z]+)", goal)
    return match.group(1) if match else "Rahim"


def step(step_id: str, action: str, tool: str, arguments: dict[str, Any], deps: list[str] | None = None,
         risk: str = "low", approval: bool = False, **extra: Any) -> dict[str, Any]:
    return {"step_id": step_id, "action": action, "tool": tool, "arguments": arguments,
            "dependencies": deps or [], "risk_level": risk, "requires_approval": approval, **extra}


def plan_for(goal: str, answers: str, google: Any) -> dict[str, Any]:
    g = goal.lower()
    name = contact_name(goal)
    ref = {"$ref": "steps.find_contact.output.best.email"}
    if ("clarify" in g or len(g.split()) <= 2) and not answers:
        return {"goal": goal, "summary": "Clarify the request first.", "steps": [],
                "needs_user_input": ["What exactly should I do, and for whom?"]}
    if any(k in g for k in ("meeting", "schedule", "calendar", "invite")):
        if "flaky" in g:
            from app.evaluation.simulators.google_workspace import Failure

            google.fail("calendar.freebusy", Failure(kind="status", status=503, reason="backendError", times=3))
        return {
            "goal": goal,
            "summary": f"Find a free 30-minute slot tomorrow after 2 PM, invite {name}, then e-mail a confirmation.",
            "steps": [
                step("find_slot", "Find a free 30-minute slot tomorrow after 2 PM", "calendar.find_free_slots",
                     {"date": "tomorrow", "duration_minutes": 30, "earliest_time": "14:00", "latest_time": "18:00"}),
                step("find_contact", f"Look up {name}'s e-mail address", "contacts.lookup", {"name": name}),
                step("create_meeting", f"Schedule the meeting with {name}", "calendar.create_event",
                     {"summary": f"Meeting with {name}", "start": {"$ref": "steps.find_slot.output.slots.0.start"},
                      "end": {"$ref": "steps.find_slot.output.slots.0.end"}, "attendees": [ref]},
                     ["find_slot", "find_contact"], risk="medium", approval=True, verification_method="read_back"),
                step("send_confirmation", f"E-mail {name} a confirmation", "gmail.send",
                     {"to": [ref], "subject": "Meeting confirmation",
                      "body": f"Hi {name},\n\nOur meeting is confirmed for {{{{steps.create_meeting.output.start}}}}."
                              "\n\nBest regards"},
                     ["create_meeting", "find_contact"], risk="high", approval=True),
            ],
        }
    if "draft" in g:
        return {"goal": goal, "summary": f"Draft an e-mail to {name} for your review.", "steps": [
            step("find_contact", f"Look up {name}'s e-mail address", "contacts.lookup", {"name": name}),
            step("draft", f"Draft the e-mail to {name}", "gmail.create_draft",
                 {"to": [ref], "subject": "Quick follow-up",
                  "body": f"Hi {name},\n\nFollowing up on our conversation."},
                 ["find_contact"], risk="low"),
        ]}
    if any(k in g for k in ("email", "e-mail", "send", "message")):
        return {"goal": goal, "summary": f"Send {name} an e-mail after your approval.", "steps": [
            step("find_contact", f"Look up {name}'s e-mail address", "contacts.lookup", {"name": name}),
            step("send", f"E-mail {name}", "gmail.send",
                 {"to": [ref], "subject": "Hello from AgentOS", "body": f"Hi {name},\n\n{goal}\n\nBest regards"},
                 ["find_contact"], risk="high", approval=True),
        ]}
    if any(k in g for k in ("inbox", "unread", "emails")):
        return {"goal": goal, "summary": "Scan recent unread e-mail.", "steps": [
            step("scan", "Search unread e-mail from the last day", "gmail.search",
                 {"query": "is:unread newer_than:1d", "max_results": 20}),
        ]}
    if "remember" in g:
        return {"goal": goal, "summary": "Save this to memory.", "steps": [
            step("save", "Save the preference", "memory.save",
                 {"content": goal.replace("Remember", "").replace("remember", "").strip(" :,.") or goal,
                  "memory_type": "preference", "importance": 0.7}),
        ]}
    topic = goal.rstrip("?.! ")
    return {"goal": goal, "summary": "Answer directly.", "steps": [],
            "direct_response": (f"**Simulated answer** — {topic}.\n\nThis response comes from the scripted planner of "
                                "the simulated backend (no model or tools were called). With a configured model, "
                                "AgentOS would research and answer this, citing its sources.")}


def build_model(google: Any, latency_s: float) -> Any:
    from app.core.exceptions import ModelUnavailable
    from app.model_gateway.providers.scripted import ScriptedProvider
    from app.model_gateway.router import ModelRouter

    def handle(request: Any) -> str | Exception:
        purpose = request.metadata.purpose
        if purpose == "planning":
            goal, answers = extract_goal(request)
            return json.dumps(plan_for(goal, answers, google))
        if purpose == "memory_extraction":
            return json.dumps({"memories": []})
        if request.response_schema is None and not request.json_mode:
            return "Simulated text generated by the scripted model."
        return ModelUnavailable(f"The simulated model has no script for '{purpose}'")

    class SlowScripted(ScriptedProvider):
        async def generate(self, request: Any, model: str) -> Any:
            if latency_s:
                await asyncio.sleep(latency_s * 2)
            return await super().generate(request, model)

    return ModelRouter(SlowScripted(handle), usage_sink=None)


# --------------------------------------------------------------------------- server
def build_app(google: Any, public_url: str) -> Any:
    from fastapi.responses import HTMLResponse, RedirectResponse

    import app.integrations.google.oauth as oauth
    from app.main import create_app

    oauth.AUTH_URL = f"{public_url}/__sim/google/consent"
    app = create_app()

    @app.get("/__sim/google/consent", include_in_schema=False)
    async def consent(redirect_uri: str, state: str, scope: str = "", nonce: str | None = None,
                      login_hint: str | None = None, email: str | None = None) -> Any:
        if email is None and "openid" in scope.split() and "email" in scope.split() and len(scope.split()) == 3:
            # Sign in with Google: let the developer choose the Google account (values are HTML-escaped).
            hidden = "".join(
                f'<input type=hidden name="{html.escape(k)}" value="{html.escape(v)}">'
                for k, v in (("redirect_uri", redirect_uri), ("state", state), ("scope", scope), ("nonce", nonce or ""))
            )
            default_email = html.escape(login_hint or "google.user@example.com")
            page = (
                "<!doctype html><meta charset=utf-8><title>Simulated Google sign-in</title>"
                '<body style="font:15px system-ui;background:#0b0c0f;color:#e8eaee;display:grid;place-items:center;'
                'height:100vh"><form method=get action="/__sim/google/consent" '
                'style="width:340px;display:grid;gap:12px">'
                '<h1 style="font-size:18px;margin:0">Simulated Google account</h1>'
                '<p style="margin:0;color:#9aa1ad">AgentOS simulated backend — no data leaves this machine.</p>'
                f'<input name=email type=email required value="{default_email}" style="padding:10px;border-radius:8px;'
                'border:1px solid #333;background:#15171c;color:inherit">'
                f"{hidden}"
                '<button style="padding:10px;border-radius:8px;border:0;background:#5ce1e6;color:#041316;'
                'font-weight:600">Continue</button></form></body>'
            )
            return HTMLResponse(page)
        code = google.issue_code(scope, email or "owner@example.com", nonce)
        sep = "&" if "?" in redirect_uri else "?"
        return RedirectResponse(f"{redirect_uri}{sep}{urlencode({'code': code, 'state': state})}", status_code=302)

    return app


async def serve(port: int, latency_ms: int, public_url: str) -> None:
    import uvicorn

    from app.core.config import get_settings
    from app.core.database import get_session_factory
    from app.core.redis import get_redis
    from app.files.storage import build_storage
    from app.integrations.google.oauth import GoogleOAuthClient, set_google_http
    from app.integrations.vault import CredentialVault
    from app.model_gateway.router import set_model_router
    from app.tools.services import ToolServices, set_tool_services
    from app.workers.queues.base import Queues
    from app.workers.worker import Worker

    settings = get_settings()
    if settings.is_production:
        raise SystemExit("simulated_backend.py refuses to run with APP_ENV=staging/production")
    latency = max(0, latency_ms) / 1000
    google, http = build_google(latency)
    seed_calendar(google)
    set_google_http(http)
    model = build_model(google, latency)
    set_model_router(model)
    sf = get_session_factory()
    set_tool_services(ToolServices(
        session_factory=sf, vault=CredentialVault(sf, google_oauth=GoogleOAuthClient(http=http), redis=get_redis()),
        model=model, google_http=http, storage=build_storage(settings), search=None, settings=settings))

    app = build_app(google, public_url)
    worker = Worker(list(Queues.DEFAULT_WORKER), concurrency=4, worker_id=f"sim-worker-{uuid.uuid4().hex[:6]}")
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", proxy_headers=True)
    server = uvicorn.Server(config)
    print(f"[simulated backend] API http://127.0.0.1:{port}/api/v1  (latency {latency_ms} ms; providers simulated)",
          flush=True)
    worker_task = asyncio.create_task(worker.run())
    try:
        await server.serve()
    finally:
        worker.request_stop()
        await asyncio.wait_for(worker_task, timeout=15)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=int(os.environ.get("SIM_PORT", "8000")))
    parser.add_argument("--latency-ms", type=int, default=int(os.environ.get("SIM_LATENCY_MS", "350")))
    parser.add_argument("--public-url", default=os.environ.get("SIM_PUBLIC_URL"),
                        help="URL browsers use to reach this server (for the simulated consent page)")
    args = parser.parse_args()
    asyncio.run(serve(args.port, args.latency_ms, args.public_url or f"http://localhost:{args.port}"))


if __name__ == "__main__":
    main()
