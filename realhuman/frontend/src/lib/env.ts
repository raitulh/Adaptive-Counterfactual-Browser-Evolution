import { toSafeExternalUrl } from "@/lib/utils/url";

/**
 * Public runtime configuration. `NEXT_PUBLIC_*` variables are inlined at build
 * time, so each one must be referenced statically below.
 *
 * Parsed by hand (no schema library) because this module is imported by
 * nearly every page and must stay tiny. Invalid values fall back to safe
 * defaults instead of crashing the site.
 */
export interface Env {
  NEXT_PUBLIC_PRODUCT_NAME: string;
  NEXT_PUBLIC_SITE_URL: string | undefined;
  NEXT_PUBLIC_API_BASE_URL: string;
  NEXT_PUBLIC_VERIFICATION_MODE: "mock" | "live";
  /** Public site key sent with new verification sessions (live mode). */
  NEXT_PUBLIC_SITE_KEY: string | undefined;
  NEXT_PUBLIC_ENABLE_DEMO: boolean;
  NEXT_PUBLIC_ENABLE_3D: boolean;
  NEXT_PUBLIC_GITHUB_URL: string | undefined;
}

const SITE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const name = source.NEXT_PUBLIC_PRODUCT_NAME?.trim();
  return {
    NEXT_PUBLIC_PRODUCT_NAME: name && name.length <= 40 ? name : "RealHuman",
    NEXT_PUBLIC_SITE_URL: toSafeExternalUrl(source.NEXT_PUBLIC_SITE_URL) ?? undefined,
    NEXT_PUBLIC_API_BASE_URL:
      toSafeExternalUrl(source.NEXT_PUBLIC_API_BASE_URL) ?? "http://localhost:8000",
    NEXT_PUBLIC_VERIFICATION_MODE:
      source.NEXT_PUBLIC_VERIFICATION_MODE?.trim() === "live" ? "live" : "mock",
    NEXT_PUBLIC_SITE_KEY: SITE_KEY.test(source.NEXT_PUBLIC_SITE_KEY?.trim() ?? "")
      ? source.NEXT_PUBLIC_SITE_KEY!.trim()
      : undefined,
    NEXT_PUBLIC_ENABLE_DEMO: flag(source.NEXT_PUBLIC_ENABLE_DEMO, true),
    NEXT_PUBLIC_ENABLE_3D: flag(source.NEXT_PUBLIC_ENABLE_3D, true),
    NEXT_PUBLIC_GITHUB_URL: toSafeExternalUrl(source.NEXT_PUBLIC_GITHUB_URL) ?? undefined,
  };
}

export const env: Env = parseEnv({
  NEXT_PUBLIC_PRODUCT_NAME: process.env.NEXT_PUBLIC_PRODUCT_NAME,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_VERIFICATION_MODE: process.env.NEXT_PUBLIC_VERIFICATION_MODE,
  NEXT_PUBLIC_SITE_KEY: process.env.NEXT_PUBLIC_SITE_KEY,
  NEXT_PUBLIC_ENABLE_DEMO: process.env.NEXT_PUBLIC_ENABLE_DEMO,
  NEXT_PUBLIC_ENABLE_3D: process.env.NEXT_PUBLIC_ENABLE_3D,
  NEXT_PUBLIC_GITHUB_URL: process.env.NEXT_PUBLIC_GITHUB_URL,
});
