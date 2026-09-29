/**
 * Usage metering.
 */
import { api, call } from "./client";

type Opts = { signal?: AbortSignal };

export const usageApi = {
  summary: (query: { org_wide?: boolean } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/usage", { params: { query }, signal: o.signal })),
};
