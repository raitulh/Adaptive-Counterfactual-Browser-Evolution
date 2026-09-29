import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";

/**
 * Server state lives in TanStack Query. Defaults:
 *  - reads retry only transient failures (network/5xx/429), never 4xx;
 *  - mutations never retry automatically (writes that may be retried use idempotency keys explicitly);
 *  - realtime streams invalidate precisely, so polling is off unless a hook opts in.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (isApiError(error)) return error.isRetryable && failureCount < 2;
          return failureCount < 1;
        },
        retryDelay: (attempt, error) => {
          if (isApiError(error) && error.retryAfterSeconds) return error.retryAfterSeconds * 1000;
          return Math.min(8_000, 500 * 2 ** attempt);
        },
      },
      mutations: { retry: false },
    },
  });
}
