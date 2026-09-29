/**
 * Tool catalogue and organization tool policies (allow/deny/approval rules).
 */
import { api, call } from "./client";
import type { ConnectGoogleResponse, ToolConnectRequest, ToolRuleIn } from "./schemas";

type Opts = { signal?: AbortSignal };

export const toolsApi = {
  list: (o: Opts = {}) => call(api.GET("/api/v1/tools", { signal: o.signal })),
  /** Starts an OAuth connect for the provider a tool needs; returns the backend authorization URL. */
  connect: (body: ToolConnectRequest): Promise<ConnectGoogleResponse> =>
    call(api.POST("/api/v1/tools/connect", { body })),
  policies: (o: Opts = {}) => call(api.GET("/api/v1/tools/policies", { signal: o.signal })),
  createPolicy: (body: ToolRuleIn) => call(api.POST("/api/v1/tools/policies", { body })),
  deletePolicy: (ruleId: string) =>
    call(api.DELETE("/api/v1/tools/policies/{rule_id}", { params: { path: { rule_id: ruleId } } })),
};
