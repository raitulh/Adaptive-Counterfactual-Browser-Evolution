/**
 * Plans and entitlements (fetched, never hard-coded).
 */
import { api, call } from "./client";

type Opts = { signal?: AbortSignal };

export const billingApi = {
  plans: (o: Opts = {}) => call(api.GET("/api/v1/billing/plans", { signal: o.signal })),
  entitlements: (o: Opts = {}) => call(api.GET("/api/v1/billing/entitlements", { signal: o.signal })),
};
