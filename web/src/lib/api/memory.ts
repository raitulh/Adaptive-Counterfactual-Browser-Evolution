/**
 * Memory OS: long-term memories, semantic search and verification.
 */
import { api, call, newIdempotencyKey } from "./client";
import type { paths } from "./generated/schema";
import type { MemoryCreate, MemorySearchRequest } from "./schemas";

type Opts = { signal?: AbortSignal };

export type ListMemoryQuery = NonNullable<paths["/api/v1/memory"]["get"]["parameters"]["query"]>;

export const memoryApi = {
  list: (query: ListMemoryQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/memory", { params: { query }, signal: o.signal })),
  create: (body: MemoryCreate, idempotencyKey: string = newIdempotencyKey()) =>
    call(api.POST("/api/v1/memory", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
  search: (body: MemorySearchRequest, o: Opts = {}) =>
    call(api.POST("/api/v1/memory/search", { body, signal: o.signal })),
  remove: (memoryId: string) =>
    call(api.DELETE("/api/v1/memory/{memory_id}", { params: { path: { memory_id: memoryId } } })),
  verify: (memoryId: string) =>
    call(api.POST("/api/v1/memory/{memory_id}/verify", { params: { path: { memory_id: memoryId } } })),
};
