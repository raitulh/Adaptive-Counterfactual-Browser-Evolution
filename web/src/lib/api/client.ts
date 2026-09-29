/**
 * The typed AgentOS API client. All backend communication goes through this module (and the domain
 * modules built on it) — components never call fetch directly.
 */
import createClient from "openapi-fetch";
import { env } from "@/lib/config/env";
import { errorFromResponse, normalizeError } from "./errors";
import type { paths } from "./generated/schema";
import { authFetch } from "./http";

function baseUrl(): string {
  if (env.apiIsCrossOrigin) return env.apiOrigin;
  if (typeof window !== "undefined") return `${window.location.origin}${env.apiOrigin}`;
  // Server-side rendering never calls the API with user credentials; keep URLs well-formed anyway.
  return `${env.siteUrl}${env.apiOrigin}`;
}

export const api = createClient<paths>({ baseUrl: baseUrl(), fetch: authFetch });

export type ApiPaths = paths;

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Await an openapi-fetch call and return its data, throwing a normalized AgentOSApiError otherwise. */
export async function call<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch (err) {
    throw normalizeError(err);
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined) throw errorFromResponse(response, error);
  return data as T;
}

/** A fresh key for one logical write. Reuse the same key when retrying the same submission. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
