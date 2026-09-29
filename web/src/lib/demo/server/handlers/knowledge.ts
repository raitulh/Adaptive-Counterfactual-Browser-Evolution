/** Memory OS, files (multipart upload → processing → ready) and document search. */
import type { DocumentSearchHit, FileOut, MemoryOut, MemoryType, RetrievedMemory } from "@/lib/api";
import {
  Body,
  conflict,
  type Ctx,
  DemoHttpError,
  invalid,
  json,
  noContent,
  notFound,
  paginate,
  queryEnum,
} from "../http";
import type { Router, Srv } from "../router";
import type { DemoStore, FileRec, MemoryRec } from "../store";
import { clone, DAY, iso, sha256Hex, uuid } from "../util";
import { idempotent, requirePermission } from "./common";

const MEMORY_TYPES = [
  "conversational",
  "short_term",
  "long_term",
  "semantic",
  "preference",
  "task_history",
  "verified_fact",
  "contact",
] as const satisfies readonly MemoryType[];
const MAX_AGE_DAYS: Record<string, number> = {
  contact: 180,
  preference: 365,
  verified_fact: 90,
  semantic: 365,
  long_term: 365,
  task_history: 90,
  short_term: 1,
  conversational: 7,
};

export function freshness(m: MemoryRec, now: number): MemoryOut["freshness"] {
  if (m.status === "conflicted" || m.confidence < 0.5) return "unverified";
  if (now - Date.parse(m.last_verified_at) > (MAX_AGE_DAYS[m.memory_type] ?? 365) * DAY) return "stale";
  return "fresh";
}

function memoryOut(store: DemoStore, m: MemoryRec): MemoryOut {
  const { userId: _u, ...rest } = m;
  void _u;
  return { ...clone(rest), freshness: freshness(m, store.now()) };
}

function findMemory(ctx: Ctx, store: DemoStore): MemoryRec {
  const m = store.memories.find(
    (x) => x.id === ctx.params.memory_id && x.userId === store.me.id && x.status !== "deleted",
  );
  if (!m) throw notFound("Memory not found");
  return m;
}

const terms = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9@.]{3,}/g) ?? []);

function overlap(query: Set<string>, text: string): number {
  if (!query.size) return 0;
  const words = terms(text);
  let hit = 0;
  for (const q of query) if ([...words].some((w) => w.startsWith(q) || q.startsWith(w))) hit += 1;
  return hit / query.size;
}

async function createMemory(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "memory:write");
  const raw = await ctx.json();
  const b = new Body(raw).forbidExtra(["content", "memory_type", "subject_key", "importance", "expires_at"]);
  const content = b.str("content", { min: 1, max: 2000 });
  const type = b.optEnum("memory_type", MEMORY_TYPES) ?? "long_term";
  const subjectKey = b.optStr("subject_key", { max: 200 });
  const importance = b.optNum("importance", { min: 0, max: 1 }) ?? 0.7;
  const expires = b.optStr("expires_at");
  if (expires && Number.isNaN(Date.parse(expires)))
    b.fail("expires_at", "Input should be a valid datetime", "datetime_parsing");
  b.done();
  return idempotent(ctx, srv, raw, () => {
    const now = store.nowIso();
    const defaultTtl = type === "short_term" ? DAY : type === "conversational" ? 7 * DAY : null;
    const m: MemoryRec = {
      id: uuid(),
      userId: store.me.id,
      content: content.trim(),
      memory_type: type,
      subject_key: subjectKey,
      confidence: 1,
      importance,
      source_type: "user_stated",
      source_reference: `user:${store.me.id}`,
      status: "active",
      superseded_by: null,
      created_at: now,
      updated_at: now,
      last_verified_at: now,
      expires_at: expires ? iso(Date.parse(expires)) : defaultTtl ? iso(store.now() + defaultTtl) : null,
      last_accessed_at: null,
      access_count: 0,
    };
    // A statement from the user wins any conflict on the same subject.
    if (subjectKey) {
      for (const old of store.memories) {
        if (
          old.userId === m.userId &&
          old.subject_key === subjectKey &&
          (old.status === "active" || old.status === "conflicted")
        ) {
          old.status = "superseded";
          old.superseded_by = m.id;
          old.updated_at = now;
        }
      }
    }
    store.memories.push(m);
    store.addUsage("embedding");
    store.audit(
      {
        category: "memory",
        action: "memory.create",
        resource_type: "memory",
        resource_id: m.id,
        metadata: { memory_type: type, status: "active" },
      },
      ctx.requestId,
    );
    return { status: 201, body: memoryOut(store, m) };
  });
}

async function searchMemory(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "memory:read");
  const b = new Body(await ctx.json());
  const query = b.str("query", { min: 1, max: 500 });
  const limit = b.optNum("limit", { int: true, min: 1, max: 20 }) ?? 8;
  const types = b.optStrList("memory_types");
  b.done();
  const q = terms(query);
  const now = store.now();
  const results: RetrievedMemory[] = store.memories
    .filter(
      (m) =>
        m.userId === store.me.id &&
        (m.status === "active" || m.status === "conflicted") &&
        (!m.expires_at || Date.parse(m.expires_at) > now),
    )
    .filter((m) => !types || types.includes(m.memory_type))
    .map((m) => {
      const keyword = overlap(q, `${m.content} ${m.subject_key ?? ""}`);
      const recency = 0.5 ** ((now - Date.parse(m.last_verified_at)) / (30 * DAY));
      const fresh = freshness(m, now);
      const score =
        0.45 * keyword + 0.25 * keyword + 0.2 * m.importance + 0.1 * recency - (fresh === "fresh" ? 0 : 0.1);
      return { m, score, keyword, fresh };
    })
    .filter((x) => x.keyword > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ m, score, fresh }) => {
      m.access_count += 1;
      m.last_accessed_at = store.nowIso();
      return {
        id: m.id,
        content: m.content,
        memory_type: m.memory_type,
        confidence: m.confidence,
        importance: m.importance,
        freshness: fresh,
        last_verified_at: m.last_verified_at,
        score: Math.round(score * 1000) / 1000,
        source_type: m.source_type,
        source_reference: m.source_reference,
        status: m.status,
        subject_key: m.subject_key,
      };
    });
  return json(ctx, 200, { results });
}

function verifyMemory(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "memory:write");
  const m = findMemory(ctx, store);
  if (m.status === "superseded")
    throw conflict("This memory was replaced by a newer one. Save it again to restore it.", "memory_superseded");
  const now = store.nowIso();
  m.last_verified_at = now;
  m.updated_at = now;
  m.confidence = Math.max(m.confidence, 0.9);
  if (m.status === "conflicted") {
    for (const other of store.memories) {
      if (other !== m && other.subject_key && other.subject_key === m.subject_key && other.status === "active") {
        other.status = "superseded";
        other.superseded_by = m.id;
      }
    }
    m.status = "active";
  }
  store.audit(
    {
      category: "memory",
      action: "memory.verify",
      resource_type: "memory",
      resource_id: m.id,
      metadata: { memory_type: m.memory_type },
    },
    ctx.requestId,
  );
  return json(ctx, 200, memoryOut(store, m));
}

// ---------------------------------------------------------------------------- files
const MAX_UPLOAD = 25 * 1024 * 1024;
const READABLE = new Set(["uploaded", "processing", "ready"]);

function fileOut(f: FileRec): FileOut {
  const { blob: _b, text: _t, ...out } = f;
  void _b;
  void _t;
  return clone(out);
}

function findFile(ctx: Ctx, store: DemoStore): FileRec {
  const f = store.files.find((x) => x.id === ctx.params.file_id && x.user_id === store.me.id && x.status !== "deleted");
  if (!f) throw notFound("File not found.");
  return f;
}

const EXT_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Simulated processing pipeline: uploaded → processing (scan + extraction) → ready. */
export function processFile(store: DemoStore, file: FileRec, readyAfterMs = 2600): void {
  store.sched.after(700, () => {
    if (file.status !== "uploaded") return;
    file.status = "processing";
    file.updated_at = store.nowIso();
  });
  store.sched.after(readyAfterMs, () => {
    if (file.status !== "processing") return;
    const text = file.text;
    const pdf = file.content_type === "application/pdf";
    file.status = "ready";
    file.updated_at = store.nowIso();
    file.metadata = {
      extraction_status: text || pdf ? "completed" : "skipped",
      char_count: text ? text.length : pdf ? Math.round(file.size_bytes / 50) : null,
      chunk_count: text
        ? Math.max(1, Math.ceil(text.length / 1200))
        : pdf
          ? Math.max(1, Math.round(file.size_bytes / 60_000))
          : null,
      language: text || pdf ? "en" : null,
      page_count: pdf ? Math.max(1, Math.round(file.size_bytes / 170_000)) : null,
      extracted_summary: text ? text.replace(/\s+/g, " ").trim().slice(0, 160) || null : null,
    };
    store.addUsage("embedding", file.metadata.chunk_count ?? 0);
  });
}

async function upload(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "files:write");
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw invalid([{ loc: ["body", "file"], msg: "Field required", type: "missing" }]);
  }
  const file = form.get("file");
  const purpose = String(form.get("purpose") ?? "user_upload");
  if (!file || typeof file === "string")
    throw invalid([{ loc: ["body", "file"], msg: "Field required", type: "missing" }]);
  if (purpose !== "user_upload" && purpose !== "temp") {
    throw invalid([{ loc: ["body", "purpose"], msg: "Input should be 'user_upload' or 'temp'", type: "enum" }]);
  }
  if (file.size === 0) throw new DemoHttpError(422, "empty_file", "The file is empty.");
  if (file.size > MAX_UPLOAD)
    throw new DemoHttpError(413, "payload_too_large", "The file exceeds the maximum upload size.", {
      max_bytes: MAX_UPLOAD,
    });
  const name = (file.name || "upload").replace(/[\\/]/g, "_").slice(0, 200);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXT_TYPES[ext] ?? (file.type || "application/octet-stream");
  const bytes = await file.arrayBuffer();
  const sha = await sha256Hex(bytes);
  const text =
    contentType.startsWith("text/") || contentType === "application/json"
      ? new TextDecoder().decode(bytes).slice(0, 200_000)
      : null;
  return idempotent(ctx, srv, { name, size: file.size, sha, purpose }, () => {
    const now = store.nowIso();
    const rec: FileRec = {
      id: uuid(),
      user_id: store.me.id,
      filename: name,
      content_type: contentType,
      size_bytes: file.size,
      sha256: sha,
      purpose,
      scan_status: "clean",
      status: "uploaded",
      task_id: null,
      expires_at: purpose === "temp" ? iso(store.now() + DAY) : null,
      created_at: now,
      updated_at: now,
      metadata: {
        extraction_status: "pending",
        char_count: null,
        chunk_count: null,
        language: null,
        page_count: null,
        extracted_summary: null,
      },
      blob: new Blob([bytes], { type: contentType }),
      text,
    };
    store.files.push(rec);
    store.addUsage("storage_bytes", file.size);
    store.audit(
      {
        category: "data",
        action: "file.uploaded",
        resource_type: "file",
        resource_id: rec.id,
        metadata: { content_type: contentType, size_bytes: file.size, sha256: sha, purpose, scan_status: "clean" },
      },
      ctx.requestId,
    );
    processFile(store, rec);
    return { status: 201, body: fileOut(rec) };
  });
}

function downloadUrl(ctx: Ctx, { store }: Srv) {
  const f = findFile(ctx, store);
  if (!READABLE.has(f.status)) throw notFound("File not found.");
  const blob =
    f.blob ??
    new Blob([f.text ?? `${f.filename}\n\nThis is a sample file of the AgentOS demo workspace.\n`], {
      type: f.blob ? f.content_type : "text/plain",
    });
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    url = `data:text/plain;charset=utf-8,${encodeURIComponent(f.text ?? f.filename)}`;
  }
  return json(ctx, 200, { url, expires_at: iso(store.now() + 300_000), filename: f.filename, method: "GET" });
}

async function searchDocuments(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "files:read");
  const b = new Body(await ctx.json());
  const query = b.str("query", { min: 1, max: 500 });
  const limit = b.optNum("limit", { int: true, min: 1, max: 50 }) ?? 10;
  b.done();
  const q = terms(query);
  const hits: DocumentSearchHit[] = [];
  for (const f of store.files) {
    if (f.user_id !== store.me.id || f.status !== "ready" || !f.text) continue;
    f.text.split(/\n\s*\n/).forEach((chunk, i) => {
      const score = overlap(q, chunk);
      if (score <= 0) return;
      hits.push({
        chunk_id: uuid(),
        chunk_index: i,
        content: chunk.trim().slice(0, 1200),
        document_id: f.id,
        source_id: f.id,
        source_type: "file",
        title: f.filename,
        url: null,
        keyword_score: Math.round(score * 1000) / 1000,
        vector_score: null,
        score: Math.round(score * 1000) / 1000,
      });
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return json(ctx, 200, { query, results: hits.slice(0, limit), used_vector_search: false });
}

export function knowledgeRoutes(r: Router): void {
  r.add("GET", "/memory", (ctx, { store }) => {
    requirePermission(store, "memory:read");
    const type = queryEnum(ctx, "memory_type", MEMORY_TYPES);
    const status = queryEnum(ctx, "status", ["active", "superseded", "conflicted"] as const);
    const rows = store.memories.filter(
      (m) =>
        m.userId === store.me.id &&
        m.status !== "deleted" &&
        (!type || m.memory_type === type) &&
        (!status || m.status === status),
    );
    return json(
      ctx,
      200,
      paginate(ctx, rows, (m) => memoryOut(store, m)),
    );
  })
    .add("POST", "/memory", createMemory)
    .add("POST", "/memory/search", searchMemory)
    .add("DELETE", "/memory/{memory_id}", (ctx, { store }) => {
      requirePermission(store, "memory:write");
      const m = findMemory(ctx, store);
      m.status = "deleted";
      m.updated_at = store.nowIso();
      store.audit(
        { category: "memory", action: "memory.delete", resource_type: "memory", resource_id: m.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("POST", "/memory/{memory_id}/verify", verifyMemory)
    .add("GET", "/files", (ctx, { store }) => {
      requirePermission(store, "files:read");
      const purpose = ctx.query.get("purpose");
      const status = queryEnum(ctx, "status", ["uploaded", "processing", "ready", "quarantined", "failed"] as const);
      const rows = store.files.filter(
        (f) =>
          f.user_id === store.me.id &&
          f.status !== "deleted" &&
          (!purpose || f.purpose === purpose) &&
          (!status || f.status === status),
      );
      return json(ctx, 200, paginate(ctx, rows, fileOut));
    })
    .add("POST", "/files", upload)
    .add("GET", "/files/{file_id}", (ctx, { store }) => json(ctx, 200, fileOut(findFile(ctx, store))))
    .add("DELETE", "/files/{file_id}", (ctx, { store }) => {
      requirePermission(store, "files:write");
      const f = findFile(ctx, store);
      f.status = "deleted";
      f.updated_at = store.nowIso();
      store.audit(
        { category: "data", action: "file.deleted", resource_type: "file", resource_id: f.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("GET", "/files/{file_id}/download-url", downloadUrl)
    .unavailable("GET", "/files/download", "Signed download links are served directly by the demo (download-url).")
    .add("POST", "/search/documents", searchDocuments)
    .unavailable(
      "POST",
      "/search/web",
      "Live web search is not available in the demo — it never contacts the internet.",
    );
}
