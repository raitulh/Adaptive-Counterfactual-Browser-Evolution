import * as z from "zod";
import { apiKeyEnvironmentSchema, webhookEventTypeSchema } from "@/lib/schemas/dashboard";

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address."));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z.object({
  email,
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(128, "Use at most 128 characters."),
});
export type SignupValues = z.infer<typeof signupSchema>;

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name the key so you can recognize it later.")
    .max(48, "Keep the name under 48 characters.")
    .regex(/^[\w .-]+$/, "Use letters, numbers, spaces, dots, dashes or underscores."),
  environment: apiKeyEnvironmentSchema,
});
export type CreateApiKeyValues = z.infer<typeof createApiKeySchema>;

export const createWebhookSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter the endpoint URL.")
    .pipe(z.url({ protocol: /^https$/, error: "Use an https:// URL." })),
  events: z.array(webhookEventTypeSchema).min(1, "Select at least one event."),
});
export type CreateWebhookValues = z.infer<typeof createWebhookSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email,
  company: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000, "Keep it under 1,000 characters.").optional(),
});
export type ContactValues = z.infer<typeof contactSchema>;

export const projectSettingsSchema = z
  .object({
    projectName: z.string().trim().min(2, "Enter a project name.").max(60),
    allowThreshold: z.number().min(0.5, "Minimum is 0.50.").max(0.99, "Maximum is 0.99."),
    stepUpThreshold: z.number().min(0.1, "Minimum is 0.10.").max(0.95, "Maximum is 0.95."),
    retentionDays: z.enum(["1", "7", "30"]),
  })
  .refine((values) => values.stepUpThreshold < values.allowThreshold, {
    path: ["stepUpThreshold"],
    error: "Step-up threshold must be lower than the allow threshold.",
  });
export type ProjectSettingsValues = z.infer<typeof projectSettingsSchema>;
