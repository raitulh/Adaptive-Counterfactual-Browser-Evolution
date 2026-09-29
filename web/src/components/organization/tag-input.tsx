"use client";

import { XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { cleanList, normalizeEntry, splitEntries, validateEntry, type EntryKind } from "./policy-form";

/**
 * Chip list editor for policy lists (tool patterns, domains). Enter, comma or paste adds entries;
 * Backspace on an empty input removes the last one. Entries are normalized and validated as typed.
 */
export function TagInput({
  id,
  kind,
  value,
  onChange,
  placeholder,
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  tone = "neutral",
}: {
  id?: string;
  kind: EntryKind;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  tone?: "neutral" | "danger" | "warning" | "success";
}) {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  function add(text: string) {
    const entries = splitEntries(text).map((e) => normalizeEntry(kind, e));
    if (entries.length === 0) return;
    const invalid = entries.find((e) => validateEntry(kind, e) !== null);
    if (invalid !== undefined) {
      setError(`“${invalid}”: ${validateEntry(kind, invalid)}`);
      return;
    }
    setError(null);
    onChange(cleanList(kind, [...value, ...entries]));
    setDraft("");
  }

  const chipTone = {
    neutral: "border-line-strong bg-surface-3 text-fg",
    danger: "border-danger/30 bg-danger/10 text-danger",
    warning: "border-warning/30 bg-warning/10 text-warning",
    success: "border-success/30 bg-success/10 text-success",
  }[tone];

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-surface-1 px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25",
          invalid || error ? "border-danger/60" : "border-line-strong",
          disabled && "opacity-60",
        )}
      >
        {value.map((entry) => (
          <span key={entry} className={cn("inline-flex h-6 max-w-full items-center gap-1 rounded border pl-2 font-mono text-xs", chipTone, disabled && "pr-2")}>
            <span className="truncate">{entry}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== entry))}
                className="flex size-5 items-center justify-center rounded text-current opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/50"
                aria-label={`Remove ${entry}`}
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id={id}
            value={draft}
            disabled={disabled}
            aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
            aria-invalid={invalid || Boolean(error) || undefined}
            onChange={(e) => {
              setError(null);
              const v = e.target.value;
              if (/[,;\n]/.test(v)) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/[\s,;]/.test(text.trim())) {
                e.preventDefault();
                add(text);
              }
            }}
            onBlur={() => draft.trim() && add(draft)}
            placeholder={value.length ? "Add another…" : placeholder}
            className="h-6 min-w-32 flex-1 bg-transparent px-1 font-mono text-xs text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle"
          />
        )}
        {disabled && value.length === 0 && <span className="px-1 text-xs text-fg-subtle">None</span>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
