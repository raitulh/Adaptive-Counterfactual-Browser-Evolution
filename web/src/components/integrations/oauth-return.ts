/**
 * The backend OAuth callback redirects the browser back to `/app/integrations` with
 * `?status=connected` or `?status=error&reason=<code>` (app/integrations/router.py). The reason is
 * either Google's `error` parameter (e.g. `access_denied`) or an AgentOS error code raised while
 * completing the connection. This module turns those into user-facing outcomes.
 */

export type OAuthReturn =
  { kind: "connected" } | { kind: "error"; reason: string; title: string; message: string; retryable: boolean };

interface ReasonCopy {
  title: string;
  message: string;
  retryable: boolean;
}

const REASONS: Record<string, ReasonCopy> = {
  // Google authorization-endpoint errors
  access_denied: {
    title: "Google access was not granted",
    message: "The consent screen was cancelled or access was declined, so nothing was connected.",
    retryable: true,
  },
  admin_policy_enforced: {
    title: "Blocked by your Google Workspace admin",
    message:
      "Your organization's Google admin does not allow this app or one of the requested permissions. Ask them to allow AgentOS, or request fewer capabilities.",
    retryable: false,
  },
  org_internal: {
    title: "Not available for this Google account",
    message: "This Google OAuth client is limited to users of a specific Google Workspace organization.",
    retryable: false,
  },
  invalid_scope: {
    title: "Google rejected the requested permissions",
    message: "One of the requested scopes is not available for this account. Try again with fewer capabilities.",
    retryable: true,
  },
  consent_required: {
    title: "Consent is required",
    message: "Google needs you to review and accept the requested permissions. Start the connection again.",
    retryable: true,
  },
  interaction_required: {
    title: "Google needs you to sign in",
    message: "Start the connection again and complete the Google sign-in.",
    retryable: true,
  },
  temporarily_unavailable: {
    title: "Google is temporarily unavailable",
    message: "Google could not complete the request right now. Please try again in a moment.",
    retryable: true,
  },
  server_error: {
    title: "Google reported an error",
    message: "Google could not complete the authorization. Please try again.",
    retryable: true,
  },
  no_code: {
    title: "Google did not return an authorization code",
    message: "The authorization response was incomplete. Start the connection again.",
    retryable: true,
  },
  // AgentOS errors while completing the connection
  oauth_state_invalid: {
    title: "The connection link expired",
    message: "Connection links are single-use and valid for a few minutes. Start the connection again from this page.",
    retryable: true,
  },
  validation_failed: {
    title: "The connection request was invalid",
    message: "Start the connection again from this page.",
    retryable: true,
  },
  invalid_id_token: {
    title: "Google's identity could not be verified",
    message: "AgentOS could not verify the account information returned by Google, so nothing was stored. Try again.",
    retryable: true,
  },
  integration_revoked: {
    title: "Google rejected the authorization",
    message: "The authorization code was no longer valid. Start the connection again.",
    retryable: true,
  },
  integration_bad_request: {
    title: "Google rejected the token request",
    message: "The authorization could not be exchanged for access. Start the connection again.",
    retryable: true,
  },
  integration_error: {
    title: "The connection could not be completed",
    message: "Google did not return the information AgentOS needs. Start the connection again.",
    retryable: true,
  },
  integration_timeout: {
    title: "Google did not respond in time",
    message: "The connection timed out while talking to Google. Please try again.",
    retryable: true,
  },
  integration_temporarily_unavailable: {
    title: "Google is temporarily unavailable",
    message: "AgentOS could not reach Google to finish connecting. Please try again shortly.",
    retryable: true,
  },
  integration_rate_limited: {
    title: "Google is rate limiting requests",
    message: "Wait a moment, then start the connection again.",
    retryable: true,
  },
  configuration_missing: {
    title: "Google connections aren't configured",
    message: "This AgentOS deployment has no Google OAuth client configured. Contact your administrator.",
    retryable: false,
  },
};

const FALLBACK: ReasonCopy = {
  title: "The connection could not be completed",
  message: "Google or AgentOS reported a problem while connecting. Start the connection again.",
  retryable: true,
};

/** Reason codes are short snake_case identifiers; anything else is ignored (never echoed back). */
const REASON_RE = /^[a-z0-9_.-]{1,64}$/i;

export function describeOAuthError(reason: string | null | undefined): ReasonCopy & { reason: string } {
  const code = reason && REASON_RE.test(reason) ? reason.toLowerCase() : "unknown";
  return { reason: code, ...(REASONS[code] ?? FALLBACK) };
}

export function parseOAuthReturn(params: Pick<URLSearchParams, "get"> | null | undefined): OAuthReturn | null {
  if (!params) return null;
  const status = params.get("status");
  if (status === "connected") return { kind: "connected" };
  if (status === "error") return { kind: "error", ...describeOAuthError(params.get("reason")) };
  return null;
}

/** The integrations URL without the one-shot return parameters (other parameters are kept). */
export function stripOAuthReturnParams(pathname: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete("status");
  next.delete("reason");
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Human text for `ConnectionOut.last_error_code` (codes recorded by the credential vault). */
export function describeConnectionError(code: string | null | undefined): string | null {
  if (!code) return null;
  const known: Record<string, string> = {
    integration_revoked: "Google reports the authorization was revoked.",
    integration_expired: "The authorization expired and could not be refreshed.",
    insufficient_scope: "Google did not grant a permission a tool needs.",
    integration_temporarily_unavailable: "Google was unreachable during the last refresh.",
    integration_timeout: "Google did not respond in time during the last refresh.",
    integration_rate_limited: "Google rate-limited the last refresh.",
    integration_bad_request: "Google rejected the last token refresh.",
    integration_not_connected: "No usable tokens are stored for this account.",
  };
  return known[code] ?? describeOAuthError(code).message;
}
