/**
 * Web and document search.
 */
import { api, call } from "./client";
import type { DocumentSearchRequest, WebSearchRequest } from "./schemas";

type Opts = { signal?: AbortSignal };

export const searchApi = {
  web: (body: WebSearchRequest, o: Opts = {}) => call(api.POST("/api/v1/search/web", { body, signal: o.signal })),
  documents: (body: DocumentSearchRequest, o: Opts = {}) =>
    call(api.POST("/api/v1/search/documents", { body, signal: o.signal })),
};
