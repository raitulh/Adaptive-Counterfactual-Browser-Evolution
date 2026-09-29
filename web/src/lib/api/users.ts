/**
 * Current user profile and memberships.
 */
import { api, call } from "./client";
import type { AccountDeletionRequest, UserUpdate } from "./schemas";

type Opts = { signal?: AbortSignal };

export const usersApi = {
  me: (o: Opts = {}) => call(api.GET("/api/v1/users/me", { signal: o.signal })),
  update: (body: UserUpdate) => call(api.PATCH("/api/v1/users/me", { body })),
  organizations: (o: Opts = {}) => call(api.GET("/api/v1/users/me/organizations", { signal: o.signal })),
  deleteAccount: (body: AccountDeletionRequest) => call(api.DELETE("/api/v1/users/me", { body })),
};
