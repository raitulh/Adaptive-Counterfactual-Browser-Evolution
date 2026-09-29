import { describe, expect, it, vi } from "vitest";
import type { FileOut, UploadOptions } from "@/lib/api";
import { AgentOSApiError } from "@/lib/api/errors";
import { stagesForFile, stagesForUpload, uploadLabel } from "./file-status";
import { createUploadQueue, uploadReducer, type UploadItem } from "./upload-queue";
import { MAX_UPLOAD_BYTES, validateUpload } from "./validation";

function fileOut(name: string, status = "uploaded"): FileOut {
  return {
    id: `id-${name}`,
    filename: name,
    content_type: "text/plain",
    size_bytes: 3,
    sha256: "x",
    status,
    scan_status: "skipped",
    purpose: "user_upload",
    user_id: "u",
    created_at: "2026-09-29T00:00:00Z",
    updated_at: "2026-09-29T00:00:00Z",
  };
}

function item(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "a",
    file: new File(["abc"], "a.txt", { type: "text/plain" }),
    name: "a.txt",
    size: 3,
    purpose: "user_upload",
    idempotencyKey: "key-1",
    phase: "queued",
    progress: 0,
    attempts: 0,
    error: null,
    result: null,
    cancelledAfterSend: false,
    ...over,
  };
}

/** A controllable fake upload: resolve/reject/progress per call, honouring the AbortSignal. */
function fakeUploader() {
  const calls: { file: File; opts: UploadOptions; resolve: (f: FileOut) => void; reject: (e: unknown) => void }[] = [];
  const upload = vi.fn(
    (file: File, opts: UploadOptions) =>
      new Promise<FileOut>((resolve, reject) => {
        calls.push({ file, opts, resolve, reject });
        opts.signal?.addEventListener("abort", () =>
          reject(new AgentOSApiError({ status: 0, code: "aborted", message: "Upload cancelled." })),
        );
      }),
  );
  return { upload, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const txt = (name: string, body = "abc") => new File([body], name, { type: "text/plain" });

describe("uploadReducer", () => {
  it("moves through uploading → sending → done with monotonic progress", () => {
    let s = [item()];
    s = uploadReducer(s, { type: "start", id: "a" });
    expect(s[0]).toMatchObject({ phase: "uploading", attempts: 1, progress: 0 });
    s = uploadReducer(s, { type: "progress", id: "a", fraction: 0.6 });
    s = uploadReducer(s, { type: "progress", id: "a", fraction: 0.4 });
    expect(s[0].progress).toBe(0.6);
    s = uploadReducer(s, { type: "progress", id: "a", fraction: 1 });
    expect(s[0].phase).toBe("sending");
    s = uploadReducer(s, { type: "succeeded", id: "a", file: fileOut("a.txt") });
    expect(s[0]).toMatchObject({ phase: "done", result: { id: "id-a.txt" } });
  });

  it("retries keep the idempotency key and only apply to retryable failures or cancellations", () => {
    const failed = item({
      phase: "failed",
      attempts: 1,
      error: { message: "x", code: "network_error", retryable: true },
    });
    const retried = uploadReducer([failed], { type: "retry", id: "a" });
    expect(retried[0]).toMatchObject({ phase: "queued", idempotencyKey: "key-1", error: null, attempts: 1 });

    const permanent = item({
      phase: "failed",
      error: { message: "x", code: "unsupported_file_type", retryable: false },
    });
    expect(uploadReducer([permanent], { type: "retry", id: "a" })[0].phase).toBe("failed");

    const rejected = item({ phase: "rejected" });
    expect(uploadReducer([rejected], { type: "retry", id: "a" })[0].phase).toBe("rejected");
  });

  it("remembers when a cancellation happened after every byte was sent", () => {
    const s = uploadReducer([item({ phase: "sending", progress: 1 })], { type: "cancelled", id: "a" });
    expect(s[0]).toMatchObject({ phase: "cancelled", cancelledAfterSend: true });
  });

  it("ignores events for items that are no longer active", () => {
    const done = [item({ phase: "done" })];
    expect(uploadReducer(done, { type: "progress", id: "a", fraction: 0.2 })).toBe(done);
    expect(uploadReducer(done, { type: "failed", id: "a", error: { message: "", code: "", retryable: true } })).toBe(
      done,
    );
    expect(uploadReducer(done, { type: "cancelled", id: "a" })).toBe(done);
  });

  it("dismisses only finished items and clears completed ones", () => {
    const s = [item({ id: "q" }), item({ id: "d", phase: "done" }), item({ id: "f", phase: "failed" })];
    expect(uploadReducer(s, { type: "dismiss", id: "q" })).toHaveLength(3);
    expect(uploadReducer(s, { type: "dismiss", id: "f" }).map((i) => i.id)).toEqual(["q", "d"]);
    expect(uploadReducer(s, { type: "clearFinished" }).map((i) => i.id)).toEqual(["q", "f"]);
  });
});

describe("createUploadQueue", () => {
  it("uploads with bounded concurrency, reports progress and hands results over", async () => {
    const { upload, calls } = fakeUploader();
    const onUploaded = vi.fn();
    let n = 0;
    const q = createUploadQueue({ upload, concurrency: 2, newKey: () => `key-${++n}`, onUploaded });
    q.add([txt("1.txt"), txt("2.txt"), txt("3.txt")]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(q.getSnapshot().map((i) => i.phase)).toEqual(["uploading", "uploading", "queued"]);

    calls[0].opts.onProgress?.(0.5);
    expect(q.getSnapshot()[0].progress).toBe(0.5);
    calls[0].opts.onProgress?.(1);
    expect(q.getSnapshot()[0].phase).toBe("sending");

    calls[0].resolve(fileOut("1.txt"));
    await flush();
    expect(q.getSnapshot()[0].phase).toBe("done");
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: "id-1.txt" }), expect.anything());
    // The freed slot starts the third upload.
    expect(upload).toHaveBeenCalledTimes(3);
    expect(calls[2].opts.idempotencyKey).toBe("key-3");
  });

  it("cancels through the AbortSignal", async () => {
    const { upload, calls } = fakeUploader();
    const q = createUploadQueue({ upload });
    const [a] = q.add([txt("a.txt")]);
    q.cancel(a.id);
    expect(calls[0].opts.signal?.aborted).toBe(true);
    await flush();
    expect(q.getSnapshot()[0].phase).toBe("cancelled");
  });

  it("retries a failed upload with the same idempotency key", async () => {
    const { upload, calls } = fakeUploader();
    const q = createUploadQueue({ upload, newKey: () => "only-key" });
    const [a] = q.add([txt("a.txt")]);
    calls[0].reject(new AgentOSApiError({ status: 503, code: "scan_unavailable", message: "Scanner down" }));
    await flush();
    expect(q.getSnapshot()[0]).toMatchObject({ phase: "failed", error: { retryable: true } });

    q.retry(a.id);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(calls[1].opts.idempotencyKey).toBe("only-key");
    expect(q.getSnapshot()[0]).toMatchObject({ phase: "uploading", attempts: 2 });
    calls[1].resolve(fileOut("a.txt"));
    await flush();
    expect(q.getSnapshot()[0].phase).toBe("done");
  });

  it("can retry right after a cancel without the stale attempt interfering", async () => {
    const { upload, calls } = fakeUploader();
    const q = createUploadQueue({ upload, newKey: () => "k" });
    const [a] = q.add([txt("a.txt")]);
    q.cancel(a.id);
    q.retry(a.id);
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(q.getSnapshot()[0].phase).toBe("uploading");
    calls[1].resolve(fileOut("a.txt"));
    await flush();
    expect(q.getSnapshot()[0].phase).toBe("done");
  });

  it("does not retry permanent failures", async () => {
    const { upload, calls } = fakeUploader();
    const q = createUploadQueue({ upload });
    const [a] = q.add([txt("a.txt")]);
    calls[0].reject(
      new AgentOSApiError({ status: 422, code: "unsupported_file_type", message: "Executable files are not allowed." }),
    );
    await flush();
    expect(q.getSnapshot()[0].error).toMatchObject({ retryable: false, message: "Executable files are not allowed." });
    q.retry(a.id);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid files client-side without sending them", () => {
    const { upload } = fakeUploader();
    const q = createUploadQueue({ upload, validate: (f) => validateUpload(f) });
    q.add([new File([], "empty.txt"), new File(["x"], "setup.exe", { type: "application/x-msdownload" })]);
    expect(upload).not.toHaveBeenCalled();
    expect(q.getSnapshot().map((i) => i.phase)).toEqual(["rejected", "rejected"]);
  });

  it("tells the caller when a cancelled upload may still have been stored", async () => {
    const { upload, calls } = fakeUploader();
    const onSettled = vi.fn();
    const q = createUploadQueue({ upload, onSettled });
    const [a] = q.add([txt("a.txt")]);
    calls[0].opts.onProgress?.(1);
    q.cancel(a.id);
    await flush();
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ phase: "cancelled", cancelledAfterSend: true }));
  });
});

describe("validateUpload", () => {
  it("mirrors the backend limits loosely", () => {
    expect(validateUpload({ name: "a.pdf", size: 10, type: "application/pdf" })).toBeNull();
    expect(validateUpload({ name: "notes.yaml", size: 10, type: "text/yaml" })).toBeNull();
    expect(validateUpload({ name: "a.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
    expect(validateUpload({ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" })).toMatch(/limit/);
    expect(validateUpload({ name: "movie.mp4", size: 10, type: "video/mp4" })).toMatch(/isn't supported/);
  });
});

describe("file stages", () => {
  it("maps server status to the upload → scan → extract → ready pipeline", () => {
    expect(stagesForFile({ status: "uploaded" })).toEqual({
      upload: "done",
      scan: "done",
      extract: "active",
      ready: "pending",
    });
    expect(stagesForFile({ status: "ready" })).toEqual({
      upload: "done",
      scan: "done",
      extract: "done",
      ready: "done",
    });
    expect(stagesForFile({ status: "quarantined" })).toMatchObject({ scan: "failed", extract: "pending" });
    expect(stagesForFile({ status: "failed" })).toMatchObject({ scan: "done", extract: "failed" });
  });

  it("derives upload stages from the client until the server answers", () => {
    expect(stagesForUpload(item({ phase: "uploading", progress: 0.3 }))).toMatchObject({ upload: "active" });
    expect(stagesForUpload(item({ phase: "sending", progress: 1 }))).toMatchObject({ upload: "done", scan: "active" });
    const malware = item({ phase: "failed", error: { message: "", code: "malware_detected", retryable: false } });
    expect(stagesForUpload(malware)).toMatchObject({ scan: "failed" });
    const done = item({ phase: "done", result: fileOut("a.txt", "uploaded") });
    expect(stagesForUpload(done, { status: "ready" }).ready).toBe("done");
    expect(uploadLabel(item({ phase: "uploading", progress: 0.42 }))).toBe("Uploading 42%");
  });
});
