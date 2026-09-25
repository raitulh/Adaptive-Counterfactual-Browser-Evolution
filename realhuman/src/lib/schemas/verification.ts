import * as z from "zod";

/**
 * Verification contracts shared by the UI, the mock adapter and the HTTP
 * adapter. Responses from a live backend are validated against these schemas
 * before they reach any component.
 */

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const signalIdSchema = z.enum([
  "interaction_pattern",
  "challenge_response",
  "session_consistency",
  "request_behavior",
]);
export type SignalId = z.infer<typeof signalIdSchema>;

/** pass = consistent with a human session, review = inconclusive, fail = inconsistent. */
export const signalStatusSchema = z.enum(["pending", "pass", "review", "fail"]);
export type SignalStatus = z.infer<typeof signalStatusSchema>;

export const verificationSignalSchema = z.object({
  id: signalIdSchema,
  label: z.string().min(1),
  status: signalStatusSchema,
  /** Normalized 0–1 contribution. Never a verdict on its own. */
  score: z.number().min(0).max(1),
  /** Relative weight used by the policy when aggregating. */
  weight: z.number().min(0).max(1),
  detail: z.string().optional(),
});
export type VerificationSignal = z.infer<typeof verificationSignalSchema>;

export const challengeTypeSchema = z.enum(["press_hold", "single_step"]);
export type ChallengeType = z.infer<typeof challengeTypeSchema>;

export const sessionStatusSchema = z.enum([
  "created",
  "challenged",
  "analyzing",
  "completed",
  "expired",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const verificationSessionSchema = z.object({
  id: z.string().min(1),
  status: sessionStatusSchema,
  challenge: z.object({
    type: challengeTypeSchema,
    ttlSeconds: z.number().int().positive(),
  }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type VerificationSession = z.infer<typeof verificationSessionSchema>;

export const decisionSchema = z.enum(["allow", "step_up", "deny"]);
export type Decision = z.infer<typeof decisionSchema>;

export const verificationResultSchema = z.object({
  sessionId: z.string().min(1),
  verified: z.boolean(),
  decision: decisionSchema,
  risk: riskLevelSchema,
  score: z.number().min(0).max(1),
  /** Single-use token for server-side redemption. Null unless verified. */
  token: z.string().nullable(),
  signals: z.array(verificationSignalSchema),
  decidedAt: z.iso.datetime(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const inputMethodSchema = z.enum(["pointer", "touch", "keyboard", "assistive"]);
export type InputMethod = z.infer<typeof inputMethodSchema>;

export const challengeResponseSchema = z.object({
  type: challengeTypeSchema,
  inputMethod: inputMethodSchema,
  holdDurationMs: z.number().int().nonnegative(),
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const createSessionInputSchema = z.object({
  /** Public site key identifying the integration. Safe to expose. */
  siteKey: z.string().min(1).optional(),
  action: z.string().max(64).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
