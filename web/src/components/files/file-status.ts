/**
 * Presentation for the file lifecycle, from backend values only:
 *
 *   upload (client XHR) → scan (synchronous, inside the upload request: sniff + malware scan + store)
 *   → extract (`uploaded` = queued for the worker, `processing` = extracting/indexing) → ready
 *
 * `quarantined` (malware) and `failed` (extraction) are terminal failures. Image files become
 * `ready` without text (`extraction_status = skipped`).
 */
import type { ExtractionStatus, FileOut, FileStatus } from "@/lib/api";
import type { Tone } from "@/lib/status";
import type { UploadItem } from "./upload-queue";

export type FileStage = "upload" | "scan" | "extract" | "ready";
export const FILE_STAGES: { id: FileStage; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "scan", label: "Scan" },
  { id: "extract", label: "Extract" },
  { id: "ready", label: "Ready" },
];

export interface FileStatusMeta {
  label: string;
  tone: Tone;
  description: string;
  stage: FileStage;
  /** Still changing on the server (poll while any file is in this state). */
  processing?: boolean;
  failed?: boolean;
}

export const fileStatusMeta: Record<FileStatus, FileStatusMeta> = {
  uploaded: {
    label: "Queued for extraction",
    tone: "accent",
    stage: "extract",
    processing: true,
    description: "Stored and scanned. Waiting for a worker to extract and index its text.",
  },
  processing: {
    label: "Extracting",
    tone: "accent",
    stage: "extract",
    processing: true,
    description: "Extracting text and indexing it for document search.",
  },
  ready: { label: "Ready", tone: "success", stage: "ready", description: "Available to your agents and to document search." },
  quarantined: {
    label: "Quarantined",
    tone: "danger",
    stage: "scan",
    failed: true,
    description: "Rejected by the malware scanner. It can't be downloaded or read.",
  },
  failed: {
    label: "Extraction failed",
    tone: "danger",
    stage: "extract",
    failed: true,
    description: "The document couldn't be read. It can still be downloaded, but it isn't searchable.",
  },
  deleted: { label: "Deleted", tone: "neutral", stage: "ready", description: "Deleted." },
};

const UNKNOWN_STATUS: FileStatusMeta = { label: "Unknown", tone: "neutral", stage: "extract", description: "Unrecognized status." };

export function metaForFileStatus(status: string): FileStatusMeta {
  return (fileStatusMeta as Record<string, FileStatusMeta>)[status] ?? UNKNOWN_STATUS;
}

export function isFileProcessing(file: Pick<FileOut, "status">): boolean {
  return Boolean(metaForFileStatus(file.status).processing);
}

/** Backend ScanStatus (app/files/scanning.py). */
export const scanStatusMeta: Record<string, { label: string; tone: Tone; description: string }> = {
  pending: { label: "Not scanned yet", tone: "neutral", description: "Waiting for the malware scanner." },
  clean: { label: "Clean", tone: "success", description: "The malware scanner found nothing." },
  infected: { label: "Infected", tone: "danger", description: "The malware scanner flagged this file." },
  skipped: {
    label: "Not scanned",
    tone: "neutral",
    description: "No malware scanner is configured on this server; the type was still checked from its bytes.",
  },
  error: { label: "Scan error", tone: "danger", description: "The malware scanner failed." },
};

export const extractionStatusMeta: Record<ExtractionStatus, { label: string; tone: Tone; description: string }> = {
  pending: { label: "Pending", tone: "accent", description: "Text extraction hasn't finished yet." },
  completed: { label: "Extracted", tone: "success", description: "All text was extracted and indexed." },
  truncated: {
    label: "Extracted (truncated)",
    tone: "warning",
    description: "The document is very large; only the first part was extracted and indexed.",
  },
  skipped: { label: "No text", tone: "neutral", description: "This type has no extractable text (e.g. images)." },
  failed: { label: "Failed", tone: "danger", description: "The document couldn't be read." },
};

export function metaForExtraction(status: string | null | undefined) {
  return status ? ((extractionStatusMeta as Record<string, (typeof extractionStatusMeta)["pending"]>)[status] ?? null) : null;
}

export type StageState = "pending" | "active" | "done" | "failed";

/** Stage states for a stored file (server truth). */
export function stagesForFile(file: Pick<FileOut, "status">): Record<FileStage, StageState> {
  const meta = metaForFileStatus(file.status);
  const order: FileStage[] = ["upload", "scan", "extract", "ready"];
  const idx = order.indexOf(meta.stage);
  const out = {} as Record<FileStage, StageState>;
  order.forEach((s, i) => {
    if (i < idx) out[s] = "done";
    else if (i > idx) out[s] = "pending";
    else out[s] = meta.failed ? "failed" : meta.processing ? "active" : "done";
  });
  return out;
}

/**
 * Stage states for an upload in the queue. Before the server answers we only know the client
 * side (bytes sent → the server is sniffing, scanning and storing); afterwards the latest server
 * copy of the file (from the polled list) is authoritative.
 */
export function stagesForUpload(item: UploadItem, server?: Pick<FileOut, "status"> | null): Record<FileStage, StageState> {
  if (item.phase === "done") return stagesForFile(server ?? item.result ?? { status: "uploaded" });
  const failed = item.phase === "failed";
  const code = item.error?.code ?? "";
  const scanFailure = failed && /malware|scan|unsupported_file_type|empty_file|unsafe/.test(code);
  switch (item.phase) {
    case "queued":
    case "rejected":
    case "cancelled":
      return { upload: item.phase === "rejected" ? "failed" : "pending", scan: "pending", extract: "pending", ready: "pending" };
    case "uploading":
      return { upload: "active", scan: "pending", extract: "pending", ready: "pending" };
    case "sending":
      return { upload: "done", scan: "active", extract: "pending", ready: "pending" };
    case "failed":
      return scanFailure
        ? { upload: "done", scan: "failed", extract: "pending", ready: "pending" }
        : { upload: "failed", scan: "pending", extract: "pending", ready: "pending" };
  }
}

/** A short live label for an upload row. */
export function uploadLabel(item: UploadItem, server?: Pick<FileOut, "status"> | null): string {
  switch (item.phase) {
    case "queued":
      return "Waiting to upload";
    case "uploading":
      return `Uploading ${Math.round(item.progress * 100)}%`;
    case "sending":
      return "Scanning & storing";
    case "done":
      return metaForFileStatus((server ?? item.result)?.status ?? "uploaded").label;
    case "failed":
      return "Upload failed";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return "Not uploaded";
  }
}

/** Short type label from the sniffed content type. */
export function kindLabel(contentType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "text/plain": "Text",
    "text/csv": "CSV",
    "text/markdown": "Markdown",
    "application/json": "JSON",
    "text/html": "HTML",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/gif": "GIF",
    "image/webp": "WebP",
  };
  return map[contentType] ?? (contentType.split("/")[1]?.toUpperCase() || "File");
}

export const PURPOSE_LABELS: Record<string, string> = {
  user_upload: "Upload",
  task_artifact: "Task artifact",
  browser_artifact: "Browser artifact",
  temp: "Temporary",
};
