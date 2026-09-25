import type { RealHumanApi } from "@/lib/api/types";

/**
 * Loads the adapter on demand. Marketing pages call this on first interaction
 * so adapter and validation code stay out of the initial bundle.
 */
export function loadApi(): Promise<RealHumanApi> {
  return import("@/lib/api/index").then((module) => module.getApi());
}
