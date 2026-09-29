/**
 * Auth endpoints. Session state (tokens, refresh, cross-tab sync) lives in session.ts; the
 * AuthProvider (src/lib/auth) orchestrates flows. Login always asks for cookie delivery so the
 * refresh token never reaches JavaScript.
 */
import { api, call } from "./client";
import type {
  ChangePasswordRequest,
  LoginRequest,
  MfaEnrollResponse,
  RegisterRequest,
  SessionOut,
  StreamTokenResponse,
  TokenResponse,
} from "./schemas";

export const authApi = {
  login: (body: Omit<LoginRequest, "token_delivery">): Promise<TokenResponse> =>
    call(api.POST("/api/v1/auth/login", { body: { ...body, token_delivery: "cookie" } })),

  /** Returns tokens in the body (the backend has no cookie delivery for registration). */
  register: (body: RegisterRequest): Promise<TokenResponse> => call(api.POST("/api/v1/auth/register", { body })),

  logout: () => call(api.POST("/api/v1/auth/logout")),
  logoutAll: () => call(api.POST("/api/v1/auth/logout-all")),

  sessions: (): Promise<SessionOut[]> => call(api.GET("/api/v1/auth/sessions")),
  revokeSession: (sessionId: string) =>
    call(api.DELETE("/api/v1/auth/sessions/{session_id}", { params: { path: { session_id: sessionId } } })),

  switchOrganization: (organizationId: string): Promise<TokenResponse> =>
    call(api.POST("/api/v1/auth/switch-organization", { body: { organization_id: organizationId } })),

  changePassword: (body: ChangePasswordRequest) => call(api.POST("/api/v1/auth/password/change", { body })),

  mfaEnroll: (): Promise<MfaEnrollResponse> => call(api.POST("/api/v1/auth/mfa/enroll")),
  mfaConfirm: (factorId: string, code: string) =>
    call(api.POST("/api/v1/auth/mfa/{factor_id}/confirm", { params: { path: { factor_id: factorId } }, body: { code } })),
  mfaDisable: (code: string) => call(api.POST("/api/v1/auth/mfa/disable", { body: { code } })),

  /** Short-lived token (type=stream) for SSE connections. Never put access tokens in URLs. */
  streamToken: (): Promise<StreamTokenResponse> => call(api.POST("/api/v1/auth/stream-token")),

  googleStart: () => call(api.GET("/api/v1/auth/oauth/google/start")),
  googleCallback: (code: string, state: string): Promise<TokenResponse> =>
    call(
      api.GET("/api/v1/auth/oauth/google/callback", {
        params: { query: { code, state, token_delivery: "cookie" } },
      }),
    ),
};
