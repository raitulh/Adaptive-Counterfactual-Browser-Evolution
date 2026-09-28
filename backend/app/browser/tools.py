"""browser tools.

Every browser tool is asynchronous: ``execute`` validates the request (action budget,
egress policy, feature flag, per-tenant launch rate limit), persists a ``BrowserTask`` and
enqueues it for the isolated browser worker in one short transaction, and returns
``pending_external``. The worker reports the observations through the external-outcome
path, after which the engine calls ``verify`` on them.

Browser output is untrusted external content. Verification is evidence based: the final
URL must be on an allowed domain, requested reads must have produced content, and a
side-effecting action only passes with concrete evidence (``expect_url_contains`` /
``expect_text`` observed in the browser) — otherwise it is inconclusive.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any, ClassVar, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.browser import service
from app.browser.actions import (
    MAX_EXTRACT_CHARS,
    MAX_URL_LENGTH,
    ActionValidationError,
    BrowserAction,
    Click,
    Extract,
    Fill,
    Navigate,
    Press,
    Screenshot,
    Target,
    check_action_count,
    dump_actions,
    has_side_effects,
    navigation_urls,
    resolve_locator_order,
    validate_http_url,
)
from app.browser.models import BrowserTaskStatus
from app.browser.policy import build_browser_policy, sanitize_url
from app.browser.schemas import BrowserObservations, Expectations
from app.common.enums import ErrorClass, PermissionLevel, RiskLevel, TrustLevel, VerificationStatus
from app.common.feature_flags import Flags, require_enabled
from app.common.sanitize import clean_text
from app.core.database import set_tenant_scope
from app.core.exceptions import FeatureDisabled, NeedsUserInput, ToolInputInvalid
from app.security.ratelimit import get_rate_limiter
from app.tools.base import (
    IdempotencyStrategy,
    ReconcileOutcome,
    ReconcileStatus,
    RetryPolicy,
    RiskAssessment,
    Tool,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.verification.types import Difference, VerificationMethod, VerificationOutcome

if TYPE_CHECKING:
    from app.organizations.schemas import OrganizationPolicy

MAX_RUN_ACTIONS = 100  # schema ceiling; the deployment's browser_max_actions applies at execution


@contextlib.asynccontextmanager
async def _tenant_session(tctx: ToolContext) -> AsyncIterator[AsyncSession]:
    async with tctx.services.session_factory() as session:
        set_tenant_scope(session, tctx.tenant_id)
        yield session


def _spec(name: str, description: str, *, write: bool = False, risk: RiskLevel = RiskLevel.LOW,
          parallel_safe: bool = True) -> ToolSpec:
    return ToolSpec(
        name=name, description=description, category="browser", provider="browser",
        permission_level=PermissionLevel.WRITE if write else PermissionLevel.READ,
        risk_level=RiskLevel.HIGH if write else risk, requires_approval=write,
        idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP if write else IdempotencyStrategy.NONE,
        timeout_seconds=30, retry_policy=RetryPolicy(max_attempts=2 if write else 3),
        parallel_safe=parallel_safe and not write, feature_flag=Flags.BROWSER_AGENT,
        verification_method=VerificationMethod.BROWSER_STATE, output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
        async_execution=True,
    )


# ---------------------------------------------------------------------------- inputs
class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _UrlIn(_In):
    url: str = Field(min_length=8, max_length=MAX_URL_LENGTH, description="Absolute http(s) URL to open")

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        return validate_http_url(value)


class _ExpectMixin(_In):
    expect_url_contains: str | None = Field(
        default=None, min_length=1, max_length=500,
        description="Verification evidence: a substring the page URL must contain afterwards")
    expect_text: str | None = Field(
        default=None, min_length=1, max_length=300,
        description="Verification evidence: text that must be visible on the page afterwards")


class NavigateIn(_UrlIn):
    pass


class ExtractIn(_UrlIn):
    target: Target | None = Field(default=None, description="Element to read; the whole page when omitted")
    mode: Literal["text", "aria", "html_outline"] = "text"
    max_chars: int = Field(default=8_000, ge=100, le=MAX_EXTRACT_CHARS)


class ScreenshotIn(_UrlIn):
    full_page: bool = False


class ClickIn(_UrlIn, _ExpectMixin):
    target: Target


class FillIn(_UrlIn, _ExpectMixin):
    target: Target
    value: str = Field(max_length=5000)
    submit: bool = Field(default=False, description="Press Enter in the field after filling it")


class RunIn(_In, _ExpectMixin):
    actions: list[BrowserAction] = Field(min_length=1, max_length=MAX_RUN_ACTIONS)

    @model_validator(mode="after")
    def _starts_with_navigation(self) -> RunIn:
        if not isinstance(self.actions[0], Navigate):
            raise ValueError("a browser sequence must start with a navigate action (each run is a fresh browser)")
        return self


# ---------------------------------------------------------------------------- base
class BrowserTool(Tool[Any, BrowserObservations]):
    output_model = BrowserObservations
    extract_required: ClassVar[bool] = False
    screenshot_required: ClassVar[bool] = False

    def build_actions(self, args: Any) -> list[BrowserAction]:
        raise NotImplementedError

    def expectations(self, args: Any) -> Expectations:
        return Expectations(url_contains=getattr(args, "expect_url_contains", None),
                            text=getattr(args, "expect_text", None))

    def side_effecting(self, args: Any) -> bool:
        return has_side_effects(self.build_actions(args))

    def target(self, args: Any) -> str | None:
        urls = navigation_urls(self.build_actions(args))
        host = _host(urls[0]) if urls else None
        return f"web:{host}" if host else None

    # ------------------------------------------------------------------ execute
    async def execute(self, tctx: ToolContext, args: Any) -> ToolResult:
        settings = tctx.services.settings
        if not settings.browser_enabled:
            raise FeatureDisabled("Browser automation is disabled on this server.", details={"feature": "browser"})
        actions = self.build_actions(args)
        try:
            check_action_count(actions, max_actions=settings.browser_max_actions)
        except ActionValidationError as exc:
            raise ToolInputInvalid(str(exc)) from exc
        policy = build_browser_policy(settings, org_allowed=tctx.org_policy.browser_allowed_domains,
                                      org_denied=tctx.org_policy.browser_denied_domains)
        for url in navigation_urls(actions):
            await policy.check_url(url)  # UnsafeURL (policy_blocked) before anything is queued
        side_effects = has_side_effects(actions)
        await get_rate_limiter().enforce("browser_launch", str(tctx.tenant_id),
                                         settings.rate_limit_browser_launch_per_minute)
        expectations = self.expectations(args)
        options = {
            "locator_order": list(resolve_locator_order(tctx.strategy.get("browser_locator_order"))),
            "expect": expectations.model_dump(exclude_none=True),
            "step_attempt": tctx.attempt_number,
            "max_step_attempts": self.spec.retry_policy.max_attempts,
            "side_effects": side_effects,
        }
        async with _tenant_session(tctx) as session:
            await require_enabled(session, Flags.BROWSER_AGENT, tctx.tenant_id)
            if side_effects and not self.spec.has_side_effects:
                await self._refuse_repeat(session, tctx)
            task, created = await service.dispatch_browser_task(
                session, tenant_id=tctx.tenant_id, user_id=tctx.user_id, task_id=tctx.task_id,
                step_id=tctx.step_id, idempotency_key=tctx.idempotency_key, tool_name=self.spec.name,
                actions=dump_actions(actions), options=options,
                timeout_seconds=settings.browser_task_timeout_seconds)
            if side_effects:
                audit.record(session, ctx=tctx.ctx, category=AuditCategory.TOOL, action="browser.task.dispatched",
                             task_id=tctx.task_id, step_id=tctx.step_id, tool_name=self.spec.name,
                             resource_type="browser_task", resource_id=task.id,
                             metadata={"actions": len(actions), "created": created,
                                       "hosts": sorted({h for h in map(_host, navigation_urls(actions)) if h})})
            await session.commit()
            browser_task_id = str(task.id)
        return ToolResult(output={"browser_task_id": browser_task_id},
                          summary=f"Dispatched {len(actions)} action(s) to an isolated browser",
                          external_ref=browser_task_id, trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
                          pending_external=True)

    async def _refuse_repeat(self, session: AsyncSession, tctx: ToolContext) -> None:
        """This tool's step key changes per attempt, so the engine cannot tell that an earlier
        attempt already clicked/typed. Never repeat interactive actions blindly."""
        for earlier in await service.list_step_tasks(session, tctx.step_id):
            if earlier.idempotency_key == tctx.idempotency_key or not has_side_effects(earlier.actions or []):
                continue
            if earlier.status == BrowserTaskStatus.QUEUED:
                await service.cancel_queued(session, earlier, reason="Superseded by a newer attempt.")
                continue
            took_effect = earlier.status in (BrowserTaskStatus.SUCCEEDED, BrowserTaskStatus.RUNNING) or (
                earlier.status == BrowserTaskStatus.FAILED and earlier.error_class == ErrorClass.UNKNOWN_OUTCOME.value)
            if took_effect:
                raise NeedsUserInput(
                    "An earlier attempt of this step already performed interactive browser actions and its "
                    "effect could not be confirmed automatically.",
                    questions=["An earlier attempt already clicked or typed on the page. Please check the result "
                               "and confirm whether the browser actions should be run again."],
                    details={"browser_task_id": str(earlier.id)})

    # ------------------------------------------------------------------ verify
    async def verify(self, tctx: ToolContext, args: Any, result: ToolResult) -> VerificationOutcome:
        method = VerificationMethod.BROWSER_STATE
        try:
            obs = BrowserObservations.model_validate(result.output)
        except ValidationError:
            return VerificationOutcome.failed_with(
                method, [Difference(field="output", expected="browser observations", observed="malformed")])
        expectations = self.expectations(args)
        observed: dict[str, Any] = {
            "status": obs.status, "final_url": obs.final_url, "actions_executed": obs.actions_executed,
            "extracts": len(obs.extracts), "screenshots": len(obs.screenshots), "blocked_requests": obs.blocked_total,
        }
        evidence: dict[str, Any] = {"browser_task_id": obs.browser_task_id,
                                    "checks": [c.model_dump() for c in obs.checks]}
        diffs = self._state_differences(tctx, args, obs)
        for kind, expected in (("url_contains", expectations.url_contains), ("text", expectations.text)):
            if expected is None:
                continue
            check = next((c for c in obs.checks if c.kind == kind and c.expected == expected), None)
            if check is None or not check.satisfied:
                diffs.append(Difference(field=f"expect_{kind}", expected=expected,
                                        observed=check.observed if check else None))
        expected_fields = expectations.model_dump(exclude_none=True)
        if diffs:
            return VerificationOutcome.failed_with(method, diffs, expected=expected_fields, observed=observed,
                                                   evidence=evidence)
        if self.side_effecting(args) and expectations.empty:
            return VerificationOutcome(
                status=VerificationStatus.INCONCLUSIVE, method=method, observed=observed,
                evidence={**evidence, "reason": "interactive actions ran, but no expected URL or text was given "
                                                "to confirm their effect"})
        return VerificationOutcome.passed_with(method, expected=expected_fields, observed=observed, evidence=evidence)

    def _state_differences(self, tctx: ToolContext, args: Any, obs: BrowserObservations) -> list[Difference]:
        diffs: list[Difference] = []
        if obs.status != "succeeded":
            diffs.append(Difference(field="status", expected="succeeded", observed=obs.status))
        planned = self.build_actions(args)
        failed = [entry.index for entry in obs.action_log if entry.status != "ok"]
        if failed or obs.actions_executed < len(planned):
            diffs.append(Difference(field="actions", expected=len(planned),
                                    observed={"executed": obs.actions_executed, "failed": failed}))
        if not obs.final_url:
            diffs.append(Difference(field="final_url", expected="an http(s) page", observed=None))
        else:
            policy = build_browser_policy(tctx.services.settings,
                                          org_allowed=tctx.org_policy.browser_allowed_domains,
                                          org_denied=tctx.org_policy.browser_denied_domains)
            if not (obs.final_url_allowed and policy.allows_syntax(obs.final_url)):
                diffs.append(Difference(field="final_url", expected="a domain allowed by the egress policy",
                                        observed=sanitize_url(obs.final_url)))
        extracts_planned = sum(1 for a in planned if isinstance(a, Extract))
        if extracts_planned and (len(obs.extracts) < extracts_planned or any(not e.content for e in obs.extracts)):
            diffs.append(Difference(field="extracts", expected=f"{extracts_planned} non-empty extract(s)",
                                    observed=[e.chars for e in obs.extracts]))
        shots_planned = sum(1 for a in planned if isinstance(a, Screenshot))
        if len(obs.screenshots) < shots_planned:
            diffs.append(Difference(field="screenshots", expected=shots_planned, observed=len(obs.screenshots)))
        return diffs

    # ------------------------------------------------------------------ reconcile
    async def reconcile(self, tctx: ToolContext, args: Any) -> ReconcileOutcome:
        async with _tenant_session(tctx) as session:
            view = await service.reconcile_lookup(session, tctx.idempotency_key)
            outcome: ReconcileOutcome
            if view.status == "found" and view.task is not None:
                ref = str(view.task.id)
                outcome = ReconcileOutcome(
                    status=ReconcileStatus.FOUND, evidence=view.evidence,
                    result=ToolResult(output=view.task.result or {"browser_task_id": ref},
                                      summary=service.summarize(view.task), external_ref=ref,
                                      trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT))
            elif view.status == "not_found":
                outcome = ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence=view.evidence)
            else:
                outcome = ReconcileOutcome(status=ReconcileStatus.UNKNOWN, evidence=view.evidence)
            await session.commit()
        return outcome


# ---------------------------------------------------------------------------- tools
class BrowserNavigateTool(BrowserTool):
    input_model = NavigateIn
    spec = _spec("browser.navigate", "Open a web page in an isolated browser and report its URL, title and "
                                     "accessibility snapshot")

    def build_actions(self, args: NavigateIn) -> list[BrowserAction]:
        return [Navigate(url=args.url)]

    def describe(self, args: NavigateIn) -> str:
        return f"Open {_host(args.url) or 'a web page'} in an isolated browser (browser.navigate)"


class BrowserExtractTool(BrowserTool):
    input_model = ExtractIn
    spec = _spec("browser.extract", "Open a web page in an isolated browser and extract text, an accessibility "
                                    "snapshot or a structural outline")

    def build_actions(self, args: ExtractIn) -> list[BrowserAction]:
        return [Navigate(url=args.url), Extract(target=args.target, mode=args.mode, max_chars=args.max_chars)]

    def describe(self, args: ExtractIn) -> str:
        return f"Read {args.mode} content from {_host(args.url) or 'a web page'} (browser.extract)"


class BrowserScreenshotTool(BrowserTool):
    input_model = ScreenshotIn
    spec = _spec("browser.screenshot", "Open a web page in an isolated browser and take a screenshot")

    def build_actions(self, args: ScreenshotIn) -> list[BrowserAction]:
        return [Navigate(url=args.url), Screenshot(full_page=args.full_page)]

    def describe(self, args: ScreenshotIn) -> str:
        return f"Take a screenshot of {_host(args.url) or 'a web page'} (browser.screenshot)"


class BrowserClickTool(BrowserTool):
    input_model = ClickIn
    spec = _spec("browser.click", "Open a web page in an isolated browser and click one element "
                                  "(identified by role/label/text/test id/CSS)", write=True)

    def build_actions(self, args: ClickIn) -> list[BrowserAction]:
        return [Navigate(url=args.url), Click(target=args.target)]

    def describe(self, args: ClickIn) -> str:
        return clean_text(f"Click {args.target.describe()} on {_host(args.url) or 'a web page'} (browser.click)",
                          max_chars=300)


class BrowserFillTool(BrowserTool):
    input_model = FillIn
    spec = _spec("browser.fill", "Open a web page in an isolated browser, type a value into one field and "
                                 "optionally submit it with Enter", write=True)

    def build_actions(self, args: FillIn) -> list[BrowserAction]:
        actions: list[BrowserAction] = [Navigate(url=args.url), Fill(target=args.target, value=args.value)]
        if args.submit:
            actions.append(Press(key="Enter", target=args.target))
        return actions

    def describe(self, args: FillIn) -> str:
        verb = "and submit " if args.submit else ""
        return clean_text(f"Type {len(args.value)} character(s) {verb}into {args.target.describe()} on "
                          f"{_host(args.url) or 'a web page'} (browser.fill)", max_chars=300)


class BrowserRunTool(BrowserTool):
    input_model = RunIn
    spec = _spec("browser.run", "Run a short sequence of browser actions (navigate, click, fill, wait_for, "
                                "extract, screenshot, press, select_option) in one isolated browser",
                 parallel_safe=False)

    def build_actions(self, args: RunIn) -> list[BrowserAction]:
        return list(args.actions)

    def assess(self, args: RunIn, policy: OrganizationPolicy) -> RiskAssessment:
        if has_side_effects(args.actions):
            return RiskAssessment(permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.HIGH,
                                  requires_approval=True,
                                  reasons=["the browser sequence clicks, types or submits on a web page"])
        return super().assess(args, policy)

    def describe(self, args: RunIn) -> str:
        hosts = sorted({h for h in map(_host, navigation_urls(args.actions)) if h})
        kinds = " including clicks/typing" if has_side_effects(args.actions) else ""
        return clean_text(f"Run {len(args.actions)} browser action(s){kinds} on {', '.join(hosts[:3]) or 'the web'} "
                          "(browser.run)", max_chars=300)


def _host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


TOOLS: list[Tool[Any, Any]] = [
    BrowserNavigateTool(), BrowserExtractTool(), BrowserScreenshotTool(), BrowserClickTool(), BrowserFillTool(),
    BrowserRunTool(),
]
