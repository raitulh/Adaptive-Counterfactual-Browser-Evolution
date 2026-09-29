/**
 * HTTP layer of the demo backend: request context, the AgentOS error envelope, FastAPI-shaped
 * validation errors (422 `validation_failed` with `details.errors[{loc,msg,type}]`) and keyset
 * pagination with opaque cursors — the same shapes the real API produces.
 */
import { EMAIL_RE, isUuid, uuid } from "./util";

export interface Issue {
  loc: string[];
  msg: string;
  type: string;
}

export class DemoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const notFound = (message = "Not found") => new DemoHttpError(404, "not_found", message);
export const conflict = (message: string, code = "conflict", details: Record<string, unknown> = {}) =>
  new DemoHttpError(409, code, message, details);
export const unprocessable = (message: string, code = "validation_failed", details: Record<string, unknown> = {}) =>
  new DemoHttpError(422, code, message, details);
export const notAvailable = (message = "This feature is not available in the AgentOS demo.") =>
  new DemoHttpError(501, "not_available_in_demo", message);

export function invalid(issues: Issue[]): DemoHttpError {
  return new DemoHttpError(422, "validation_failed", "The request is invalid.", { errors: issues });
}

export interface Ctx {
  request: Request;
  method: string;
  /** Path after `/api/v1`, e.g. `/tasks/123`. */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  header(name: string): string | null;
  /** Parsed JSON body (`null` when empty). Throws a 422 for malformed JSON. */
  json(): Promise<unknown>;
}

export function createCtx(request: Request, path: string): Ctx {
  let parsed: Promise<unknown> | null = null;
  return {
    request,
    method: request.method.toUpperCase(),
    path,
    params: {},
    query: new URL(request.url).searchParams,
    requestId: `req_${uuid().replace(/-/g, "").slice(0, 20)}`,
    header: (name) => request.headers.get(name),
    json() {
      parsed ??= request.text().then((text) => {
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw invalid([{ loc: ["body", "0"], msg: "JSON decode error", type: "json_invalid" }]);
        }
      });
      return parsed;
    },
  };
}

function baseHeaders(requestId: string, extra: Record<string, string> = {}): Headers {
  const headers = new Headers({ "x-request-id": requestId, "x-agentos-demo": "true", ...extra });
  return headers;
}

export function json(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const h = baseHeaders(ctx.requestId, headers);
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function noContent(ctx: Ctx): Response {
  return new Response(null, { status: 204, headers: baseHeaders(ctx.requestId) });
}

export function errorResponse(err: DemoHttpError, requestId: string): Response {
  const h = baseHeaders(requestId, err.headers);
  h.set("content-type", "application/json");
  const body = { error: { code: err.code, message: err.message, request_id: requestId, details: err.details } };
  return new Response(JSON.stringify(body), { status: err.status, headers: h });
}

// ---------------------------------------------------------------------------- body validation
type Obj = Record<string, unknown>;

/** Minimal pydantic-like validator: collects issues with FastAPI locations, throws one 422. */
export class Body {
  readonly issues: Issue[] = [];
  readonly data: Obj;

  constructor(raw: unknown, { optional = false }: { optional?: boolean } = {}) {
    if (raw === null || raw === undefined) {
      if (!optional) this.issues.push({ loc: ["body"], msg: "Field required", type: "missing" });
      this.data = {};
    } else if (typeof raw !== "object" || Array.isArray(raw)) {
      this.issues.push({ loc: ["body"], msg: "Input should be a valid dictionary or object", type: "model_attributes_type" });
      this.data = {};
    } else {
      this.data = raw as Obj;
    }
  }

  private add(field: string, msg: string, type: string) {
    this.issues.push({ loc: ["body", ...field.split(".")], msg, type });
  }

  has(field: string): boolean {
    return this.data[field] !== undefined;
  }

  forbidExtra(allowed: readonly string[]): this {
    for (const key of Object.keys(this.data)) {
      if (!allowed.includes(key)) this.add(key, "Extra inputs are not permitted", "extra_forbidden");
    }
    return this;
  }

  str(field: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string {
    const v = this.data[field];
    if (v === undefined || v === null) {
      this.add(field, "Field required", "missing");
      return "";
    }
    return this.checkStr(field, v, opts) ?? "";
  }

  optStr(field: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    return this.checkStr(field, v, opts);
  }

  private checkStr(field: string, v: unknown, { min, max, pattern }: { min?: number; max?: number; pattern?: RegExp }) {
    if (typeof v !== "string") {
      this.add(field, "Input should be a valid string", "string_type");
      return null;
    }
    if (min !== undefined && v.length < min) {
      this.add(field, `String should have at least ${min} character${min === 1 ? "" : "s"}`, "string_too_short");
    } else if (max !== undefined && v.length > max) {
      this.add(field, `String should have at most ${max} characters`, "string_too_long");
    } else if (pattern && !pattern.test(v)) {
      this.add(field, `String should match pattern '${pattern.source}'`, "string_pattern_mismatch");
    }
    return v;
  }

  email(field: string): string {
    const v = this.str(field);
    if (v && !EMAIL_RE.test(v)) this.add(field, "value is not a valid email address", "value_error");
    return v.toLowerCase();
  }

  optUuid(field: string): string | null {
    const v = this.optStr(field);
    if (v !== null && !isUuid(v)) {
      this.add(field, "Input should be a valid UUID", "uuid_parsing");
      return null;
    }
    return v;
  }

  uuid(field: string): string {
    const v = this.str(field);
    if (v && !isUuid(v)) this.add(field, "Input should be a valid UUID", "uuid_parsing");
    return v;
  }

  optNum(field: string, opts: { min?: number; max?: number; int?: boolean } = {}): number | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || Number.isNaN(v) || (opts.int && !Number.isInteger(v))) {
      this.add(field, opts.int ? "Input should be a valid integer" : "Input should be a valid number", opts.int ? "int_type" : "float_type");
      return null;
    }
    if (opts.min !== undefined && v < opts.min) {
      this.add(field, `Input should be greater than or equal to ${opts.min}`, "greater_than_equal");
    } else if (opts.max !== undefined && v > opts.max) {
      this.add(field, `Input should be less than or equal to ${opts.max}`, "less_than_equal");
    }
    return v;
  }

  num(field: string, opts: { min?: number; max?: number; int?: boolean } = {}): number {
    if (this.data[field] === undefined || this.data[field] === null) {
      this.add(field, "Field required", "missing");
      return 0;
    }
    return this.optNum(field, opts) ?? 0;
  }

  optBool(field: string): boolean | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "boolean") {
      this.add(field, "Input should be a valid boolean", "bool_type");
      return null;
    }
    return v;
  }

  optEnum<T extends string>(field: string, values: readonly T[]): T | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || !values.includes(v as T)) {
      this.add(field, `Input should be ${values.map((x) => `'${x}'`).join(", ")}`, "enum");
      return null;
    }
    return v as T;
  }

  enumOf<T extends string>(field: string, values: readonly T[]): T {
    if (this.data[field] === undefined || this.data[field] === null) {
      this.add(field, "Field required", "missing");
      return values[0];
    }
    return this.optEnum(field, values) ?? values[0];
  }

  optStrList(field: string, opts: { minItems?: number } = {}): string[] | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      this.add(field, "Input should be a valid list of strings", "list_type");
      return null;
    }
    if (opts.minItems !== undefined && v.length < opts.minItems) {
      this.add(field, `List should have at least ${opts.minItems} item after validation`, "too_short");
    }
    return v as string[];
  }

  optObj(field: string): Obj | null {
    const v = this.data[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "object" || Array.isArray(v)) {
      this.add(field, "Input should be a valid dictionary", "dict_type");
      return null;
    }
    return v as Obj;
  }

  fail(field: string, msg: string, type = "value_error"): void {
    this.add(field, msg, type);
  }

  /** Throws the collected issues as one 422. */
  done(): void {
    if (this.issues.length) throw invalid(this.issues);
  }
}

// ---------------------------------------------------------------------------- query parameters
export function queryInt(ctx: Ctx, name: string, def: number, min: number, max: number): number {
  const raw = ctx.query.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw invalid([{ loc: ["query", name], msg: "Input should be a valid integer, unable to parse string as an integer", type: "int_parsing" }]);
  }
  if (n < min) throw invalid([{ loc: ["query", name], msg: `Input should be greater than or equal to ${min}`, type: "greater_than_equal" }]);
  if (n > max) throw invalid([{ loc: ["query", name], msg: `Input should be less than or equal to ${max}`, type: "less_than_equal" }]);
  return n;
}

export function queryBool(ctx: Ctx, name: string, def = false): boolean {
  const raw = ctx.query.get(name);
  if (raw === null || raw === "") return def;
  const v = raw.toLowerCase();
  if (["true", "1", "yes", "on", "t", "y"].includes(v)) return true;
  if (["false", "0", "no", "off", "f", "n"].includes(v)) return false;
  throw invalid([{ loc: ["query", name], msg: "Input should be a valid boolean, unable to interpret input", type: "bool_parsing" }]);
}

export function queryEnum<T extends string>(ctx: Ctx, name: string, values: readonly T[]): T | null {
  const raw = ctx.query.get(name);
  if (raw === null || raw === "") return null;
  if (!values.includes(raw as T)) {
    throw invalid([{ loc: ["query", name], msg: `String should match pattern '^(${values.join("|")})$'`, type: "string_pattern_mismatch" }]);
  }
  return raw as T;
}

export function queryUuid(ctx: Ctx, name: string): string | null {
  const raw = ctx.query.get(name);
  if (raw === null || raw === "") return null;
  if (!isUuid(raw)) throw invalid([{ loc: ["query", name], msg: "Input should be a valid UUID", type: "uuid_parsing" }]);
  return raw;
}

// ---------------------------------------------------------------------------- keyset pagination
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

interface Keyed {
  created_at: string;
  id: string;
}

function b64url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

export function encodeCursor(row: Keyed): string {
  return b64url(JSON.stringify({ t: row.created_at, i: row.id, d: "desc" }));
}

function decodeCursor(cursor: string): { t: string; i: string } {
  try {
    const data = JSON.parse(unb64url(cursor)) as { t?: unknown; i?: unknown };
    if (typeof data.t !== "string" || typeof data.i !== "string" || Number.isNaN(Date.parse(data.t))) throw new Error();
    return { t: data.t, i: data.i };
  } catch {
    throw unprocessable("Invalid pagination cursor", "validation_failed", { cursor: "malformed" });
  }
}

/** Newest first by (created_at, id), `limit` 1..200 (default 50), opaque cursor — like `apply_keyset`. */
export function paginate<T extends Keyed, O = T>(ctx: Ctx, rows: T[], map: (row: T) => O = (r) => r as unknown as O): Page<O> {
  const limit = queryInt(ctx, "limit", 50, 1, 200);
  const cursor = ctx.query.get("cursor");
  const sorted = [...rows].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  let start = sorted;
  if (cursor) {
    const { t, i } = decodeCursor(cursor);
    const tMs = Date.parse(t);
    start = sorted.filter((r) => {
      const ms = Date.parse(r.created_at);
      return ms < tMs || (ms === tMs && r.id < i);
    });
  }
  const pageRows = start.slice(0, limit);
  const hasMore = start.length > limit;
  return {
    items: pageRows.map(map),
    next_cursor: hasMore && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]) : null,
    has_more: hasMore,
  };
}
