import type {
  ApiKey,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  EventOutcome,
  Overview,
  ProjectSettings,
  RequestLog,
  SessionRecord,
  VerificationEvent,
  WebhookEndpoint,
} from "@/lib/schemas/dashboard";
import type {
  ContactValues,
  CreateApiKeyValues,
  CreateWebhookValues,
  LoginValues,
  ProjectSettingsValues,
} from "@/lib/schemas/forms";
import type {
  ChallengeResponse,
  CreateSessionInput,
  VerificationResult,
  VerificationSession,
  VerificationSignal,
} from "@/lib/schemas/verification";

export type ApiMode = "mock" | "live";

/**
 * Deterministic outcomes the mock adapter can simulate. The live adapter
 * ignores this value entirely.
 */
export type DemoScenario = "success" | "step_up" | "timeout" | "network_error";

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface SubmitChallengeOptions extends RequestOptions {
  /** Called as each signal resolves, so the UI can show progress honestly. */
  onSignal?: (signal: VerificationSignal) => void;
  /** Mock adapter only. */
  scenario?: DemoScenario;
}

export interface AuthSession {
  email: string;
  workspace: string;
}

/**
 * The single contract between the UI and any verification backend.
 * `mock-api.ts` and `http-api.ts` both implement it.
 */
export interface RealHumanApi {
  readonly mode: ApiMode;

  verification: {
    createSession(
      input: CreateSessionInput,
      options?: RequestOptions,
    ): Promise<VerificationSession>;
    submitChallenge(
      sessionId: string,
      response: ChallengeResponse,
      options?: SubmitChallengeOptions,
    ): Promise<VerificationResult>;
  };

  dashboard: {
    getOverview(options?: RequestOptions): Promise<Overview>;
    listEvents(params: { limit: number }, options?: RequestOptions): Promise<VerificationEvent[]>;
    listSessions(
      params: { outcome?: EventOutcome },
      options?: RequestOptions,
    ): Promise<SessionRecord[]>;
    listRequestLogs(params: { limit: number }, options?: RequestOptions): Promise<RequestLog[]>;
  };

  apiKeys: {
    list(options?: RequestOptions): Promise<ApiKey[]>;
    create(input: CreateApiKeyValues, options?: RequestOptions): Promise<CreatedApiKey>;
    revoke(id: string, options?: RequestOptions): Promise<void>;
  };

  webhooks: {
    list(options?: RequestOptions): Promise<WebhookEndpoint[]>;
    /** A live backend also returns the endpoint's signing secret, once. */
    create(input: CreateWebhookValues, options?: RequestOptions): Promise<CreatedWebhookEndpoint>;
    remove(id: string, options?: RequestOptions): Promise<void>;
  };

  settings: {
    get(options?: RequestOptions): Promise<ProjectSettings>;
    update(values: ProjectSettingsValues, options?: RequestOptions): Promise<ProjectSettings>;
  };

  auth: {
    login(credentials: LoginValues, options?: RequestOptions): Promise<AuthSession>;
    signup(credentials: LoginValues, options?: RequestOptions): Promise<AuthSession>;
    /** The signed-in account. Rejects with UNAUTHORIZED when there is none. */
    me(options?: RequestOptions): Promise<AuthSession>;
    logout(options?: RequestOptions): Promise<void>;
  };

  contact: {
    requestAccess(input: ContactValues, options?: RequestOptions): Promise<{ received: true }>;
  };
}
