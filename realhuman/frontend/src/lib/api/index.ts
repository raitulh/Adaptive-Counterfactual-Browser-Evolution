import { createHttpApi } from "@/lib/api/http/http-api";
import { createMockApi } from "@/lib/api/mock/mock-api";
import type { RealHumanApi } from "@/lib/api/types";
import { env } from "@/lib/env";

let instance: RealHumanApi | null = null;

/**
 * Returns the configured adapter (client-side singleton).
 * `NEXT_PUBLIC_VERIFICATION_MODE=live` selects the HTTP adapter; anything else
 * uses the deterministic in-browser mock. The literal `process.env` comparison
 * is a build-time constant, so the unused adapter is dropped from the bundle.
 */
export function getApi(): RealHumanApi {
  instance ??=
    process.env.NEXT_PUBLIC_VERIFICATION_MODE === "live"
      ? createHttpApi({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL })
      : createMockApi();
  return instance;
}

export { apiMode } from "@/lib/api/mode";
export type { RealHumanApi, DemoScenario, ApiMode } from "@/lib/api/types";
export { ApiRequestError, isApiRequestError, toApiError } from "@/lib/api/errors";
