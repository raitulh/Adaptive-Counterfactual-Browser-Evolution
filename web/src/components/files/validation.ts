/**
 * Client-side upload validation — a loose mirror of the backend rules so people get instant
 * feedback. The backend re-validates everything: it sniffs the real type from the bytes
 * (app/files/processing.py ALLOWED_CONTENT_TYPES), scans for malware and enforces
 * `Settings.file_max_upload_bytes`.
 */
import { bytes } from "@/lib/format";

/** Backend default `file_max_upload_bytes` (25 MiB). The server may be configured lower. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface KindInfo {
  label: string;
  extensions: string[];
  mimes: string[];
}

/** What the backend accepts (by sniffed content), grouped for display. */
export const ACCEPTED_KINDS: KindInfo[] = [
  { label: "PDF", extensions: ["pdf"], mimes: ["application/pdf"] },
  {
    label: "Word",
    extensions: ["docx"],
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  {
    label: "Excel",
    extensions: ["xlsx"],
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  {
    label: "Images",
    extensions: ["png", "jpg", "jpeg", "gif", "webp"],
    mimes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  },
  {
    label: "Text",
    extensions: ["txt", "csv", "md", "markdown", "json", "html", "htm", "log"],
    mimes: ["text/plain", "text/csv", "text/markdown", "application/json", "text/html"],
  },
];

const EXTENSIONS = new Set(ACCEPTED_KINDS.flatMap((k) => k.extensions));
const MIMES = new Set(ACCEPTED_KINDS.flatMap((k) => k.mimes));

/** `accept` attribute for the file input. */
export const ACCEPT_ATTRIBUTE = [...EXTENSIONS].map((e) => `.${e}`).join(",");

export const ACCEPTED_SUMMARY = "PDF, Word (.docx), Excel (.xlsx), images (PNG, JPEG, GIF, WebP) and text (TXT, CSV, Markdown, JSON, HTML)";

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** A human-readable reason the file will be refused, or null when it may be uploaded. */
export function validateUpload(file: FileLike, maxBytes = MAX_UPLOAD_BYTES): string | null {
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxBytes) return `This file is ${bytes(file.size)}; the limit is ${bytes(maxBytes)}.`;
  const ext = extensionOf(file.name);
  const mime = (file.type || "").toLowerCase();
  // Plain text in any extension is accepted by the backend (it sniffs content, not names).
  if (EXTENSIONS.has(ext) || MIMES.has(mime) || mime.startsWith("text/")) return null;
  return `This file type isn't supported. Upload ${ACCEPTED_SUMMARY}.`;
}
