/**
 * Files: multipart uploads with progress, metadata, scan/extraction status and signed download URLs.
 * Uploads use XMLHttpRequest (fetch has no upload progress) with the same session rules as the typed
 * client: bearer token, one refresh-and-retry on 401, idempotency key per logical upload.
 */
import { env } from "@/lib/config/env";
import { api, call, newIdempotencyKey } from "./client";
import { AgentOSApiError, errorFromResponse } from "./errors";
import type { paths } from "./generated/schema";
import type { DownloadUrlOut, FileOut } from "./schemas";
import { apiBase, getAccessToken, refreshSession } from "./session";
import { getTransport } from "./transport";

type Opts = { signal?: AbortSignal };
export type ListFilesQuery = NonNullable<paths["/api/v1/files"]["get"]["parameters"]["query"]>;
export type UploadPurpose = "user_upload" | "temp";

export interface UploadOptions {
  purpose?: UploadPurpose;
  signal?: AbortSignal;
  /** Reuse the same key when retrying the same logical upload. */
  idempotencyKey?: string;
  onProgress?: (fraction: number) => void;
}

function xhrUpload(form: FormData, token: string | null, opts: UploadOptions, key: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/files`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("idempotency-key", key);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      const headers = new Headers();
      for (const line of xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)) {
        const idx = line.indexOf(":");
        if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
      }
      resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, headers }));
    };
    xhr.onerror = () => reject(new AgentOSApiError({ status: 0, code: "network_error", message: "Upload failed." }));
    xhr.onabort = () => reject(new AgentOSApiError({ status: 0, code: "aborted", message: "Upload cancelled." }));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

async function parse(response: Response): Promise<FileOut> {
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) throw errorFromResponse(response, body);
  return body as FileOut;
}

export const filesApi = {
  list: (query: ListFilesQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/files", { params: { query }, signal: o.signal })),
  get: (fileId: string, o: Opts = {}): Promise<FileOut> =>
    call(api.GET("/api/v1/files/{file_id}", { params: { path: { file_id: fileId } }, signal: o.signal })),
  remove: (fileId: string) => call(api.DELETE("/api/v1/files/{file_id}", { params: { path: { file_id: fileId } } })),

  /** Short-lived signed URL; resolved against the API base so it works through the same-origin pass-through. */
  async downloadUrl(fileId: string): Promise<DownloadUrlOut> {
    const out = await call(api.GET("/api/v1/files/{file_id}/download-url", { params: { path: { file_id: fileId } } }));
    return { ...out, url: resolveApiUrl(out.url) };
  },

  /** multipart/form-data upload with progress. Never JSON-encodes file content. */
  async upload(file: File, opts: UploadOptions = {}): Promise<FileOut> {
    const key = opts.idempotencyKey ?? newIdempotencyKey();
    const build = () => {
      const form = new FormData();
      form.append("file", file, file.name);
      if (opts.purpose) form.append("purpose", opts.purpose);
      return form;
    };
    if (env.demoMode) {
      const transport = await getTransport();
      const response = await transport(
        new Request(`${apiBase()}/files`, { method: "POST", body: build(), headers: { "idempotency-key": key } }),
      );
      opts.onProgress?.(1);
      return parse(response);
    }
    let response = await xhrUpload(build(), await getAccessToken().catch(() => null), opts, key);
    if (response.status === 401) {
      const session = await refreshSession({ force: true }).catch(() => null);
      if (session) response = await xhrUpload(build(), session.accessToken, opts, key);
    }
    return parse(response);
  },
};

/** Download URLs from the API may be API-relative ("/api/v1/files/download?token=…") or absolute (S3). */
export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/api/v1")) return `${env.apiOrigin}${url}`;
  return url;
}
