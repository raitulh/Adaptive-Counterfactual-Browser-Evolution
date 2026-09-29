/**
 * MCP servers: registration, approval, sync and per-tool policy.
 */
import { api, call, newIdempotencyKey } from "./client";
import type { McpServerCreate, McpToolUpdate } from "./schemas";

type Opts = { signal?: AbortSignal };

export const mcpApi = {
  servers: (o: Opts = {}) => call(api.GET("/api/v1/mcp/servers", { signal: o.signal })),
  server: (serverId: string, o: Opts = {}) =>
    call(api.GET("/api/v1/mcp/servers/{server_id}", { params: { path: { server_id: serverId } }, signal: o.signal })),
  register: (body: McpServerCreate, idempotencyKey: string = newIdempotencyKey()) =>
    call(api.POST("/api/v1/mcp/servers", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
  approve: (serverId: string) =>
    call(api.POST("/api/v1/mcp/servers/{server_id}/approve", { params: { path: { server_id: serverId } } })),
  disable: (serverId: string) =>
    call(api.POST("/api/v1/mcp/servers/{server_id}/disable", { params: { path: { server_id: serverId } } })),
  remove: (serverId: string) =>
    call(api.DELETE("/api/v1/mcp/servers/{server_id}", { params: { path: { server_id: serverId } } })),
  sync: (serverId: string) =>
    call(api.POST("/api/v1/mcp/servers/{server_id}/sync", { params: { path: { server_id: serverId } } })),
  tools: (serverId: string, o: Opts = {}) =>
    call(
      api.GET("/api/v1/mcp/servers/{server_id}/tools", { params: { path: { server_id: serverId } }, signal: o.signal }),
    ),
  updateTool: (toolId: string, body: McpToolUpdate) =>
    call(api.PATCH("/api/v1/mcp/tools/{tool_id}", { params: { path: { tool_id: toolId } }, body })),
};
