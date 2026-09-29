import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { normalizeError } from "@/lib/api";

/**
 * Map a backend 422 (`err.fieldErrors`, keyed by the request-body field path) onto react-hook-form
 * fields. Returns true when at least one field received an error, so the caller can skip a generic
 * form-level message.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: ReadonlyArray<Path<T>>,
  rename: Partial<Record<string, Path<T>>> = {},
): boolean {
  const e = normalizeError(error);
  if (e.kind !== "validation") return false;
  let mapped = false;
  for (const [key, message] of Object.entries(e.fieldErrors)) {
    const target = (rename[key] ?? key) as Path<T>;
    if (fields.includes(target)) {
      setError(target, { type: "server", message });
      mapped = true;
    }
  }
  return mapped;
}

/**
 * The backend's own explanation for a rule violation (403 "Only owners can grant the owner role",
 * 409 "An organization must keep at least one owner", …). `userMessage` deliberately hides 403/404
 * details for resources; for explicit rule messages on actions the user just attempted, the backend
 * text is the most useful thing to show.
 */
export function ruleMessage(error: unknown): string {
  const e = normalizeError(error);
  if (e.kind === "forbidden" && e.message && !/^You do not have permission/i.test(e.message)) return e.message;
  return e.userMessage;
}
