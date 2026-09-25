import * as z from "zod";
import { riskLevelSchema } from "@/lib/schemas/verification";

export const activityPointSchema = z.object({
  date: z.iso.datetime(),
  verified: z.number().int().nonnegative(),
  suspicious: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type ActivityPoint = z.infer<typeof activityPointSchema>;

export const metricSchema = z.object({
  value: z.number().int().nonnegative(),
  /** Percent change against the previous period. */
  delta: z.number(),
});
export type Metric = z.infer<typeof metricSchema>;

export const overviewSchema = z.object({
  rangeDays: z.number().int().positive(),
  sample: z.boolean(),
  metrics: z.object({
    volume: metricSchema,
    verified: metricSchema,
    suspicious: metricSchema,
    blocked: metricSchema,
  }),
  activity: z.array(activityPointSchema),
});
export type Overview = z.infer<typeof overviewSchema>;

export const eventOutcomeSchema = z.enum(["verified", "step_up", "blocked", "expired"]);
export type EventOutcome = z.infer<typeof eventOutcomeSchema>;

export const verificationEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  outcome: eventOutcomeSchema,
  risk: riskLevelSchema,
  score: z.number().min(0).max(1),
  origin: z.string(),
  action: z.string(),
  at: z.iso.datetime(),
});
export type VerificationEvent = z.infer<typeof verificationEventSchema>;

export const sessionRecordSchema = z.object({
  id: z.string(),
  outcome: eventOutcomeSchema,
  risk: riskLevelSchema,
  score: z.number().min(0).max(1),
  challenge: z.enum(["none", "press_hold", "single_step"]),
  origin: z.string(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const requestLogSchema = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "DELETE"]),
  path: z.string(),
  status: z.number().int(),
  latencyMs: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type RequestLog = z.infer<typeof requestLogSchema>;

export const apiKeyEnvironmentSchema = z.enum(["test", "live"]);
export type ApiKeyEnvironment = z.infer<typeof apiKeyEnvironmentSchema>;

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  environment: apiKeyEnvironmentSchema,
  /** Displayable masked form, e.g. `rh_test_sk_••••••••3f2e`. */
  maskedKey: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/** Only returned once, at creation time. The secret is never persisted client-side. */
export const createdApiKeySchema = apiKeySchema.extend({ secret: z.string().min(16) });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const webhookEventTypeSchema = z.enum([
  "verification.completed",
  "verification.step_up",
  "verification.blocked",
  "session.expired",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.url(),
  events: z.array(webhookEventTypeSchema).min(1),
  status: z.enum(["active", "disabled"]),
  createdAt: z.iso.datetime(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const projectSettingsRecordSchema = z.object({
  projectName: z.string(),
  siteKey: z.string(),
  allowThreshold: z.number().min(0).max(1),
  stepUpThreshold: z.number().min(0).max(1),
  retentionDays: z.enum(["1", "7", "30"]),
});
export type ProjectSettings = z.infer<typeof projectSettingsRecordSchema>;
