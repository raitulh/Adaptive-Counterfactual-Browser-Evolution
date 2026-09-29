import { api, call } from "./client";
import type { AgentCreate, AgentOut, AgentUpdate, AgentVersionIn, AgentVersionOut } from "./schemas";

type Opts = { signal?: AbortSignal };

export const agentsApi = {
  list: (query: { cursor?: string | null; limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/agents", { params: { query }, signal: o.signal })),
  get: (agentId: string, o: Opts = {}): Promise<AgentOut> =>
    call(api.GET("/api/v1/agents/{agent_id}", { params: { path: { agent_id: agentId } }, signal: o.signal })),
  create: (body: AgentCreate): Promise<AgentOut> => call(api.POST("/api/v1/agents", { body })),
  /** Updates agent metadata only; configuration changes create a new immutable version. */
  update: (agentId: string, body: AgentUpdate): Promise<AgentOut> =>
    call(api.PATCH("/api/v1/agents/{agent_id}", { params: { path: { agent_id: agentId } }, body })),
  remove: (agentId: string) =>
    call(api.DELETE("/api/v1/agents/{agent_id}", { params: { path: { agent_id: agentId } } })),
  versions: (agentId: string, o: Opts = {}): Promise<AgentVersionOut[]> =>
    call(api.GET("/api/v1/agents/{agent_id}/versions", { params: { path: { agent_id: agentId } }, signal: o.signal })),
  createVersion: (agentId: string, body: AgentVersionIn): Promise<AgentVersionOut> =>
    call(api.POST("/api/v1/agents/{agent_id}/versions", { params: { path: { agent_id: agentId } }, body })),
};
