/**
 * One Idempotency-Key per *logical* submission.
 *
 *  - the same payload retried after an unknown outcome (network error, timeout, 5xx, "in progress")
 *    reuses the key, so the backend replays the original result instead of creating a duplicate;
 *  - an edited payload gets a new key (reusing a key with a different payload is rejected);
 *  - after success the key is discarded (the next submission is a new one);
 *  - after a deterministic 4xx the backend stored that outcome for the key, so a retry needs a new key.
 */
import { newIdempotencyKey } from "@/lib/api";
import { normalizeError } from "@/lib/api/errors";

/** True when the request may or may not have been applied — retry with the SAME key. */
export function outcomeUnknown(error: unknown): boolean {
  const e = normalizeError(error);
  if (e.status === 0) return true; // network error / aborted mid-flight
  if (e.status >= 500) return true; // backend released the key
  if (e.status === 409 && e.code === "idempotency_conflict") return true; // original still running
  return false;
}

export class SubmissionKeyTracker {
  private key: string | null = null;
  private fingerprint: string | null = null;

  constructor(private readonly make: () => string = newIdempotencyKey) {}

  /** Key for this payload: reused while the payload is unchanged and no outcome was recorded. */
  keyFor(fingerprint: string): string {
    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = this.make();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  succeeded(): void {
    this.reset();
  }

  failed(error: unknown): void {
    if (!outcomeUnknown(error)) this.reset();
  }

  reset(): void {
    this.key = null;
    this.fingerprint = null;
  }

  get current(): string | null {
    return this.key;
  }
}

/** Stable JSON fingerprint (sorted keys) for comparing submissions. */
export function fingerprintOf(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, sort(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
