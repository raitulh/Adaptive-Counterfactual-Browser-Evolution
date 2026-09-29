/**
 * MCP server registration form, mirroring the backend `MCPServerCreate` constraints
 * (app/mcp/schemas.py). Secrets are write-only: the header value is sent once and never shown again.
 */
import { z } from "zod";
import type { McpServerCreate } from "@/lib/api";

export const SERVER_NAME_RE = /^[a-z][a-z0-9_]{1,40}$/;
export const HEADER_NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

/** Headers the gateway controls itself (a tenant may not override them). */
export const RESERVED_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "accept",
  "accept-encoding",
  "connection",
  "transfer-encoding",
  "user-agent",
  "mcp-session-id",
  "mcp-protocol-version",
  "cookie",
  "origin",
  "te",
  "upgrade",
  "proxy-authorization",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
]);

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export const registerServerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(SERVER_NAME_RE, "2–41 characters: lowercase letters, digits and underscores, starting with a letter"),
    url: z
      .string()
      .trim()
      .min(8, "Enter the server's Streamable HTTP endpoint")
      .max(2048, "At most 2048 characters")
      .refine((v) => !/\s/.test(v), "The URL must not contain spaces")
      .refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" || u.protocol === "http:";
        } catch {
          return false;
        }
      }, "Enter a full http(s) URL, e.g. https://mcp.example.com/mcp")
      .refine((v) => !v.includes("#"), "URL fragments (#…) are not allowed"),
    authHeaderName: z
      .string()
      .trim()
      .regex(HEADER_NAME_RE, "Letters, digits and hyphens, starting with a letter")
      .refine((v) => !RESERVED_HEADERS.has(v.toLowerCase()), "This header is controlled by the gateway"),
    authHeaderValue: z
      .string()
      .max(4096, "At most 4096 characters")
      .refine((v) => !CONTROL_CHARS.test(v), "Only printable characters are allowed"),
    timeoutSeconds: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d+(\.\d+)?$/.test(v) && Number(v) >= 0.5 && Number(v) <= 120), "From 0.5 to 120 seconds, or empty for the default"),
    rateLimitPerMinute: z
      .string()
      .trim()
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 600, "Whole number from 1 to 600"),
  });

export type RegisterServerValues = z.infer<typeof registerServerSchema>;

export const registerServerDefaults: RegisterServerValues = {
  name: "",
  url: "",
  authHeaderName: "Authorization",
  authHeaderValue: "",
  timeoutSeconds: "",
  rateLimitPerMinute: "60",
};

export function toRegisterPayload(v: RegisterServerValues): McpServerCreate {
  const secret = v.authHeaderValue;
  const payload: McpServerCreate = {
    name: v.name.trim(),
    url: v.url.trim(),
    transport: "streamable_http",
    rate_limit_per_minute: Number.parseInt(v.rateLimitPerMinute, 10),
  };
  if (secret.length > 0) {
    payload.auth_header_name = v.authHeaderName.trim();
    payload.auth_header_value = secret;
  }
  if (v.timeoutSeconds.trim() !== "") payload.timeout_seconds = Number(v.timeoutSeconds);
  return payload;
}

/** Backend 422 locations → form fields. */
export const REGISTER_FIELD_MAP: Record<string, keyof RegisterServerValues> = {
  name: "name",
  url: "url",
  auth_header_name: "authHeaderName",
  auth_header_value: "authHeaderValue",
  timeout_seconds: "timeoutSeconds",
  rate_limit_per_minute: "rateLimitPerMinute",
};
