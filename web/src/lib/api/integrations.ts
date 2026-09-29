/**
 * OAuth connections (Google Workspace). The web app never runs OAuth itself: it navigates to the
 * backend-generated authorization URL and Google returns to the backend callback.
 */
import { api, call } from "./client";
import type { ConnectGoogleRequest, ConnectGoogleResponse } from "./schemas";

type Opts = { signal?: AbortSignal };

export const integrationsApi = {
  list: (o: Opts = {}) => call(api.GET("/api/v1/integrations", { signal: o.signal })),
  /** Returns the Google authorization URL; the browser navigates there and Google returns to the backend. */
  connectGoogle: (body: ConnectGoogleRequest): Promise<ConnectGoogleResponse> =>
    call(api.POST("/api/v1/integrations/google/connect", { body })),
  check: (connectionId: string) =>
    call(
      api.POST("/api/v1/integrations/{connection_id}/check", { params: { path: { connection_id: connectionId } } }),
    ),
  disconnect: (connectionId: string) =>
    call(
      api.POST("/api/v1/integrations/{connection_id}/disconnect", {
        params: { path: { connection_id: connectionId } },
      }),
    ),
};
