"""AgentOS load-test scenarios (Locust). Read tests/load/README.md before running.

Every scenario is tagged, so each can be run on its own:

    auth       register (once per simulated user), login, refresh-token rotation
    tasks      task creation (POST /tasks with an Idempotency-Key)
    polling    task detail + task list polling
    events     SSE-less event polling (GET /tasks/{id}/events?after_seq=N)
    memory     memory search (+ occasional memory creation)
    approvals  approval list, approving the simulated user's own pending approvals
    tools      tool catalogue listing

    locust -f tests/load/locustfile.py --headless -u 200 -r 20 -t 10m \
        --host https://staging.example.com --csv results/polling --tags polling events

Environment variables:
    AGENTOS_API_PREFIX          API prefix (default /api/v1)
    AGENTOS_LOAD_USERS_FILE     CSV of pre-provisioned accounts (email,password); otherwise every
                                simulated user registers its own account
    AGENTOS_LOAD_EMAIL_DOMAIN   domain for registered accounts (default loadtest.example.com)
    AGENTOS_LOAD_SEED_TASKS     tasks each user creates at start so polling has data (default 1)
    AGENTOS_LOAD_WAIT_MIN/MAX   think time between tasks in seconds (default 1 / 5)
    AGENTOS_LOAD_MAX_FAIL_RATIO exit non-zero when the failure ratio exceeds this (default 0.01)
"""

from __future__ import annotations

import csv
import itertools
import os
import random
import secrets
import threading
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlencode

from locust import FastHttpUser, between, events, tag, task

API = os.environ.get("AGENTOS_API_PREFIX", "/api/v1").rstrip("/")
USERS_FILE = os.environ.get("AGENTOS_LOAD_USERS_FILE", "")
EMAIL_DOMAIN = os.environ.get("AGENTOS_LOAD_EMAIL_DOMAIN", "loadtest.example.com")
SEED_TASKS = int(os.environ.get("AGENTOS_LOAD_SEED_TASKS", "1"))
WAIT_MIN = float(os.environ.get("AGENTOS_LOAD_WAIT_MIN", "1"))
WAIT_MAX = float(os.environ.get("AGENTOS_LOAD_WAIT_MAX", "5"))
MAX_FAIL_RATIO = float(os.environ.get("AGENTOS_LOAD_MAX_FAIL_RATIO", "0.01"))
MAX_TRACKED_TASKS = 20

GOALS = (
    "Check my calendar tomorrow and tell me when I am free after 2 PM.",
    "Find a free 30-minute slot next Tuesday morning for a meeting with Rahim.",
    "Summarize my three most recent unread e-mails.",
    "Draft a short thank-you e-mail to the team for finishing the release.",
    "List the documents I uploaded this week and summarize the largest one.",
    "Remind me which meetings I have on Friday and who organizes them.",
)
MEMORY_QUERIES = (
    "preferred meeting length",
    "Rahim e-mail address",
    "working hours",
    "timezone",
    "project deadlines",
    "favourite meeting room",
)
MEMORY_FACTS = (
    "I prefer 30-minute meetings in the afternoon.",
    "My working hours are 9:00 to 17:30.",
    "I do not take meetings on Friday mornings.",
)


# --------------------------------------------------------------------------- accounts
class _AccountPool:
    """Round-robin over pre-provisioned accounts (shared by all users of this process)."""

    def __init__(self, path: str) -> None:
        with open(path, newline="", encoding="utf-8") as handle:
            rows = [(r[0].strip(), r[1].strip()) for r in csv.reader(handle) if len(r) >= 2 and "@" in r[0]]
        if not rows:
            raise RuntimeError(f"{path} contains no email,password rows")
        self._cycle: Iterator[tuple[str, str]] = itertools.cycle(rows)
        self._lock = threading.Lock()

    def next(self) -> tuple[str, str]:
        with self._lock:
            return next(self._cycle)


ACCOUNTS = _AccountPool(USERS_FILE) if USERS_FILE else None


def _new_password() -> str:
    # Random per simulated user; satisfies the strength rules (upper, lower, digit, symbol).
    return f"Lt-{secrets.token_urlsafe(12)}9a!"


# --------------------------------------------------------------------------- user
class AgentOSUser(FastHttpUser):
    """One simulated end user with its own account, tokens and tasks."""

    wait_time = between(WAIT_MIN, WAIT_MAX)

    def on_start(self) -> None:
        self.email = ""
        self.password = ""
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.task_ids: list[str] = []
        self.last_seq: dict[str, int] = {}
        if ACCOUNTS is not None:
            self.email, self.password = ACCOUNTS.next()
            self._login()
        else:
            self._register()
        for _ in range(max(0, SEED_TASKS)):
            self._create_task(name="tasks/create (seed)")

    # ------------------------------------------------------------------ helpers
    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"} if self.access_token else {}

    def _store_tokens(self, body: dict[str, Any]) -> None:
        self.access_token = body.get("access_token") or self.access_token
        self.refresh_token = body.get("refresh_token") or self.refresh_token

    def _register(self) -> None:
        self.email = f"load-{uuid.uuid4().hex[:16]}@{EMAIL_DOMAIN}"
        self.password = _new_password()
        with self.client.post(f"{API}/auth/register", name="auth/register", catch_response=True,
                              json={"email": self.email, "password": self.password,
                                    "display_name": "Load Test", "timezone": "UTC"}) as resp:
            if resp.status_code == 201:
                self._store_tokens(resp.json())
                resp.success()
            else:
                resp.failure(f"register failed: HTTP {resp.status_code}")

    def _login(self) -> bool:
        with self.client.post(f"{API}/auth/login", name="auth/login", catch_response=True,
                              json={"email": self.email, "password": self.password}) as resp:
            if resp.status_code == 200:
                self._store_tokens(resp.json())
                resp.success()
                return True
            resp.failure(f"login failed: HTTP {resp.status_code}")
            return False

    def _refresh(self) -> bool:
        if not self.refresh_token:
            return self._login() if self.password else False
        with self.client.post(f"{API}/auth/refresh", name="auth/refresh", catch_response=True,
                              json={"refresh_token": self.refresh_token}) as resp:
            if resp.status_code == 200:
                self._store_tokens(resp.json())
                resp.success()
                return True
            resp.failure(f"refresh failed: HTTP {resp.status_code}")
            self.refresh_token = None
            return False

    def _call(self, method: str, path: str, name: str, *, expected: tuple[int, ...] = (200,),
              params: dict[str, Any] | None = None, headers: dict[str, str] | None = None,
              json: Any = None) -> Any:
        """Authenticated request; refreshes an expired access token once and retries."""
        url = f"{API}{path}" + (f"?{urlencode(params)}" if params else "")
        for attempt in range(2):
            with self.client.request(method, url, name=name, headers={**self._headers, **(headers or {})},
                                     json=json, catch_response=True) as resp:
                if resp.status_code == 401 and attempt == 0:
                    resp.success()  # counted under the refresh request instead
                    if self._refresh():
                        continue
                    return None
                if resp.status_code in expected:
                    resp.success()
                    try:
                        return resp.json() if resp.text else {}
                    except ValueError:
                        return {}
                resp.failure(f"HTTP {resp.status_code}")
                return None
        return None

    def _create_task(self, name: str = "tasks/create") -> None:
        body = self._call("POST", "/tasks", name, expected=(202,), json={"goal": random.choice(GOALS)},
                          headers={"Idempotency-Key": f"load-{uuid.uuid4().hex}"})
        if body and body.get("task_id"):
            self.task_ids.append(body["task_id"])
            del self.task_ids[:-MAX_TRACKED_TASKS]

    # ------------------------------------------------------------------ auth
    @tag("auth")
    @task(2)
    def login(self) -> None:
        if self.password:
            self._login()

    @tag("auth")
    @task(3)
    def refresh(self) -> None:
        self._refresh()

    # ------------------------------------------------------------------ tasks
    @tag("tasks")
    @task(2)
    def create_task(self) -> None:
        self._create_task()

    # ------------------------------------------------------------------ polling
    @tag("polling")
    @task(8)
    def poll_task(self) -> None:
        if self.task_ids:
            self._call("GET", f"/tasks/{random.choice(self.task_ids)}", "tasks/get")

    @tag("polling")
    @task(2)
    def list_tasks(self) -> None:
        self._call("GET", "/tasks", "tasks/list", params={"limit": 20})

    # ------------------------------------------------------------------ events (SSE-less)
    @tag("events")
    @task(8)
    def poll_events(self) -> None:
        if not self.task_ids:
            return
        task_id = random.choice(self.task_ids)
        after = self.last_seq.get(task_id, 0)
        body = self._call("GET", f"/tasks/{task_id}/events", "tasks/events", params={"after_seq": after, "limit": 100})
        if body and body.get("next_after_seq"):
            self.last_seq[task_id] = int(body["next_after_seq"])

    # ------------------------------------------------------------------ memory
    @tag("memory")
    @task(4)
    def search_memory(self) -> None:
        self._call("POST", "/memory/search", "memory/search", json={"query": random.choice(MEMORY_QUERIES), "limit": 8})

    @tag("memory")
    @task(1)
    def create_memory(self) -> None:
        self._call("POST", "/memory", "memory/create", expected=(201,),
                   json={"content": random.choice(MEMORY_FACTS), "memory_type": "preference"},
                   headers={"Idempotency-Key": f"load-{uuid.uuid4().hex}"})

    # ------------------------------------------------------------------ approvals
    @tag("approvals")
    @task(3)
    def list_approvals(self) -> None:
        self._call("GET", "/approvals", "approvals/list", params={"status": "pending", "limit": 20})

    @tag("approvals")
    @task(1)
    def approve_pending(self) -> None:
        body = self._call("GET", "/approvals", "approvals/list", params={"status": "pending", "limit": 5})
        items = (body or {}).get("items") or []
        if items:
            # 409 = already decided/expired (a race with another request); not a server error.
            self._call("POST", f"/approvals/{items[0]['id']}/approve", "approvals/approve", expected=(200, 409),
                       headers={"Idempotency-Key": f"load-{uuid.uuid4().hex}"})

    # ------------------------------------------------------------------ tools
    @tag("tools")
    @task(2)
    def list_tools(self) -> None:
        self._call("GET", "/tools", "tools/list")


# --------------------------------------------------------------------------- run hooks
@events.test_start.add_listener
def _describe_run(environment: Any, **_: Any) -> None:
    source = f"accounts from {USERS_FILE}" if USERS_FILE else f"self-registered accounts @{EMAIL_DOMAIN}"
    print(f"[agentos-load] host={environment.host} prefix={API} {source} seed_tasks={SEED_TASKS} "
          f"wait={WAIT_MIN}-{WAIT_MAX}s max_fail_ratio={MAX_FAIL_RATIO}")


@events.quitting.add_listener
def _gate_on_failures(environment: Any, **_: Any) -> None:
    ratio = environment.stats.total.fail_ratio
    if ratio > MAX_FAIL_RATIO:
        print(f"[agentos-load] failure ratio {ratio:.2%} exceeds {MAX_FAIL_RATIO:.2%}; exiting with status 1")
        environment.process_exit_code = 1
