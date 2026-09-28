"""Typed domain exceptions.

Every error that can cross the API boundary is an ``AppError`` with a stable
machine-readable ``code`` and an HTTP status. The global handlers in
``app.api.errors`` render them into the standard error envelope::

    {"error": {"code": "...", "message": "...", "request_id": "...", "details": {}}}

Messages must be safe to show to end users: never include secrets, stack
traces or raw provider responses.
"""

from __future__ import annotations

from typing import Any

from app.common.enums import ErrorClass


class AppError(Exception):
    code: str = "internal_error"
    status_code: int = 500
    message: str = "An internal error occurred."
    error_class: ErrorClass = ErrorClass.UNKNOWN

    def __init__(self, message: str | None = None, *, details: dict[str, Any] | None = None,
                 code: str | None = None) -> None:
        self.message = message or self.message
        self.details = details or {}
        if code:
            self.code = code
        super().__init__(self.message)

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, message={self.message!r})"


# ----------------------------------------------------------------- generic HTTP-ish
class ValidationFailed(AppError):
    code = "validation_failed"
    status_code = 422
    message = "The request is invalid."
    error_class = ErrorClass.INVALID_INPUT


class BadRequest(AppError):
    code = "bad_request"
    status_code = 400
    message = "Bad request."
    error_class = ErrorClass.INVALID_INPUT


class Unauthorized(AppError):
    code = "unauthorized"
    status_code = 401
    message = "Authentication is required."


class Forbidden(AppError):
    code = "forbidden"
    status_code = 403
    message = "You do not have permission to perform this action."
    error_class = ErrorClass.PERMISSION_DENIED


class NotFound(AppError):
    code = "not_found"
    status_code = 404
    message = "Resource not found."


class Conflict(AppError):
    code = "conflict"
    status_code = 409
    message = "The resource is in a conflicting state."
    error_class = ErrorClass.CONFLICT


class PayloadTooLarge(AppError):
    code = "payload_too_large"
    status_code = 413
    message = "Request payload is too large."


class RateLimited(AppError):
    code = "rate_limited"
    status_code = 429
    message = "Too many requests. Please retry later."
    error_class = ErrorClass.RATE_LIMITED

    def __init__(self, message: str | None = None, *, retry_after: int = 1, limit: int | None = None,
                 details: dict[str, Any] | None = None) -> None:
        super().__init__(message, details={**(details or {}), "retry_after": retry_after})
        self.retry_after = retry_after
        self.limit = limit


class QuotaExceeded(AppError):
    code = "quota_exceeded"
    status_code = 429
    message = "Usage quota exceeded for the current plan."
    error_class = ErrorClass.POLICY_BLOCKED


class BudgetExceeded(AppError):
    code = "budget_exceeded"
    status_code = 422
    message = "The operation exceeds the configured execution budget."
    error_class = ErrorClass.POLICY_BLOCKED


class ServiceUnavailable(AppError):
    code = "service_unavailable"
    status_code = 503
    message = "A required dependency is temporarily unavailable."
    error_class = ErrorClass.TRANSIENT


class ConfigurationMissing(AppError):
    code = "configuration_missing"
    status_code = 503
    message = "This feature is not configured on the server."
    error_class = ErrorClass.TOOL_UNAVAILABLE


# ----------------------------------------------------------------- domain
class TenantScopeError(AppError):
    """Programming error: a tenant-scoped query was attempted without a tenant scope."""

    code = "tenant_scope_violation"
    status_code = 500
    message = "Internal data-access scope error."


class InvalidStateTransition(Conflict):
    code = "invalid_state_transition"
    message = "The requested state transition is not allowed."


class IdempotencyConflict(Conflict):
    code = "idempotency_conflict"
    message = "A request with this Idempotency-Key is in progress or had a different payload."


class PolicyDenied(Forbidden):
    code = "policy_denied"
    message = "The action is blocked by policy."
    error_class = ErrorClass.POLICY_BLOCKED


class FeatureDisabled(Forbidden):
    code = "feature_disabled"
    message = "This feature is not enabled for your organization."
    error_class = ErrorClass.POLICY_BLOCKED


class ApprovalInvalid(Conflict):
    code = "approval_invalid"
    message = "The approval is not valid for this action."
    error_class = ErrorClass.POLICY_BLOCKED


class UnsafeURL(AppError):
    code = "unsafe_url"
    status_code = 422
    message = "The URL is not allowed by the network egress policy."
    error_class = ErrorClass.POLICY_BLOCKED


# ----------------------------------------------------------------- integrations
class IntegrationError(AppError):
    code = "integration_error"
    status_code = 502
    message = "The external service returned an error."
    error_class = ErrorClass.TRANSIENT

    def __init__(self, message: str | None = None, *, provider: str | None = None,
                 details: dict[str, Any] | None = None, error_class: ErrorClass | None = None,
                 status: int | None = None) -> None:
        super().__init__(message, details={**(details or {}), **({"provider": provider} if provider else {})})
        self.provider = provider
        self.upstream_status = status
        if error_class is not None:
            self.error_class = error_class


class IntegrationNotConnected(IntegrationError):
    code = "integration_not_connected"
    status_code = 409
    message = "The required account is not connected."
    error_class = ErrorClass.AUTH_EXPIRED


class IntegrationExpired(IntegrationError):
    code = "integration_expired"
    status_code = 409
    message = "The connected account's authorization has expired. Please reconnect."
    error_class = ErrorClass.AUTH_EXPIRED


class IntegrationRevoked(IntegrationError):
    code = "integration_revoked"
    status_code = 409
    message = "The connected account's access was revoked. Please reconnect."
    error_class = ErrorClass.AUTH_EXPIRED


class InsufficientScope(IntegrationError):
    code = "insufficient_scope"
    status_code = 409
    message = "The connected account did not grant the permissions this action needs."
    error_class = ErrorClass.PERMISSION_DENIED


class IntegrationUnavailable(IntegrationError):
    code = "integration_temporarily_unavailable"
    status_code = 503
    message = "The external service is temporarily unavailable."
    error_class = ErrorClass.TRANSIENT


class IntegrationTimeout(IntegrationError):
    code = "integration_timeout"
    status_code = 504
    message = "The external service did not respond in time."
    error_class = ErrorClass.TIMEOUT


class IntegrationRateLimited(IntegrationError):
    code = "integration_rate_limited"
    status_code = 429
    message = "The external service is rate limiting requests."
    error_class = ErrorClass.RATE_LIMITED


class IntegrationBadRequest(IntegrationError):
    code = "integration_bad_request"
    status_code = 422
    message = "The external service rejected the request."
    error_class = ErrorClass.INVALID_INPUT


class IntegrationNotFound(IntegrationError):
    code = "integration_resource_not_found"
    status_code = 404
    message = "The external resource was not found."
    error_class = ErrorClass.INVALID_INPUT


class IntegrationConflict(IntegrationError):
    code = "integration_conflict"
    status_code = 409
    message = "The external resource already exists or is in conflict."
    error_class = ErrorClass.CONFLICT


# ----------------------------------------------------------------- model gateway
class ModelError(AppError):
    code = "model_error"
    status_code = 502
    message = "The AI model request failed."
    error_class = ErrorClass.MODEL_ERROR


class ModelUnavailable(ModelError):
    code = "model_unavailable"
    status_code = 503
    message = "The AI model provider is unavailable or not configured."
    error_class = ErrorClass.TOOL_UNAVAILABLE


class ModelTimeout(ModelError):
    code = "model_timeout"
    status_code = 504
    message = "The AI model did not respond in time."
    error_class = ErrorClass.TIMEOUT


class ModelRateLimited(ModelError):
    code = "model_rate_limited"
    status_code = 429
    message = "The AI model provider is rate limiting requests."
    error_class = ErrorClass.RATE_LIMITED


class ModelOutputInvalid(ModelError):
    code = "model_output_invalid"
    status_code = 502
    message = "The AI model returned output that failed validation."
    error_class = ErrorClass.MODEL_ERROR


class ModelRequestRejected(ModelError):
    code = "model_request_rejected"
    status_code = 422
    message = "The AI model provider rejected the request."
    error_class = ErrorClass.INVALID_INPUT


# ----------------------------------------------------------------- tools
class ToolError(AppError):
    code = "tool_error"
    status_code = 502
    message = "The tool failed."
    error_class = ErrorClass.UNKNOWN

    def __init__(self, message: str | None = None, *, error_class: ErrorClass | None = None,
                 details: dict[str, Any] | None = None, code: str | None = None) -> None:
        super().__init__(message, details=details, code=code)
        if error_class is not None:
            self.error_class = error_class


class ToolNotFound(ToolError):
    code = "tool_not_found"
    status_code = 404
    message = "Unknown tool."
    error_class = ErrorClass.INVALID_INPUT


class ToolInputInvalid(ToolError):
    code = "tool_input_invalid"
    status_code = 422
    message = "Tool arguments failed validation."
    error_class = ErrorClass.INVALID_INPUT


class ToolOutputInvalid(ToolError):
    code = "tool_output_invalid"
    status_code = 502
    message = "Tool returned malformed output."
    error_class = ErrorClass.UNKNOWN_OUTCOME


class ToolTimeout(ToolError):
    code = "tool_timeout"
    status_code = 504
    message = "The tool did not complete in time."
    error_class = ErrorClass.TIMEOUT


class NeedsUserInput(ToolError):
    """The tool cannot proceed without information only the user can supply."""

    code = "needs_user_input"
    status_code = 409
    message = "More information is needed from the user."
    error_class = ErrorClass.NEEDS_USER_INPUT

    def __init__(self, message: str, *, questions: list[str] | None = None,
                 details: dict[str, Any] | None = None) -> None:
        super().__init__(message, details={**(details or {}), "questions": questions or [message]})
        self.questions = questions or [message]
