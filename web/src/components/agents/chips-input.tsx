"use client";

import { XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChipsInputProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Values offered while typing (already-added values are hidden). */
  suggestions?: readonly string[];
  /** Secondary text for a suggestion (e.g. "matches 4 tools"). */
  describe?: (value: string) => React.ReactNode;
  /** Returns an error message for an invalid entry, or null. */
  validate?: (value: string) => string | null;
  placeholder?: string;
  max?: number;
  mono?: boolean;
  chipClassName?: (value: string) => string | undefined;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}

const MAX_OPTIONS = 8;

/**
 * Token input with an accessible suggestion list (combobox pattern): type and press Enter (or
 * comma) to add, Backspace on an empty field removes the last entry, arrows move through
 * suggestions.
 */
export function ChipsInput({
  id,
  value,
  onChange,
  suggestions = [],
  describe,
  validate,
  placeholder,
  max,
  mono = true,
  chipClassName,
  disabled,
  ...aria
}: ChipsInputProps) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const errorId = React.useId();

  const query = text.trim().toLowerCase();
  const options = React.useMemo(() => {
    const taken = new Set(value);
    const pool = suggestions.filter((s) => !taken.has(s));
    const matches = query ? pool.filter((s) => s.toLowerCase().includes(query)) : pool;
    // Prefix matches first.
    return matches
      .sort((a, b) => Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)))
      .slice(0, MAX_OPTIONS);
  }, [suggestions, value, query]);

  const atMax = max !== undefined && value.length >= max;

  const add = (raw: string) => {
    const item = raw.trim();
    if (!item) return;
    if (value.includes(item)) {
      setText("");
      setError(null);
      return;
    }
    if (atMax) {
      setError(`At most ${max} entries`);
      return;
    }
    const problem = validate?.(item) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...value, item]);
    setText("");
    setError(null);
    setActive(-1);
  };

  const remove = (item: string) => {
    onChange(value.filter((v) => v !== item));
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length === 0 ? -1 : (i + 1) % options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (options.length === 0 ? -1 : (i - 1 + options.length) % options.length));
    } else if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      const pick = open && active >= 0 ? options[active] : undefined;
      if (pick || text.trim()) {
        // Tab only commits typed text; it must not trap focus when the field is empty.
        e.preventDefault();
        add(pick ?? text);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const showList = open && !disabled && options.length > 0;
  const describedBy = [aria["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface-1 px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/25",
          (aria["aria-invalid"] || error) && "border-danger/60",
          disabled && "opacity-50",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((item) => (
          <span
            key={item}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-line-strong bg-surface-3 pl-2 text-xs text-fg",
              mono && "font-mono",
              chipClassName?.(item),
            )}
          >
            <span className="truncate">{item}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                remove(item);
              }}
              className="inline-flex size-6 items-center justify-center rounded-r-md text-fg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
              aria-label={`Remove ${item}`}
            >
              <XIcon className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={aria["aria-invalid"] || Boolean(error) || undefined}
          aria-label={aria["aria-label"]}
          disabled={disabled}
          value={text}
          placeholder={value.length === 0 ? placeholder : atMax ? undefined : "Add…"}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit typed text so it is never silently dropped (option clicks don't blur: they preventDefault).
            if (text.trim()) add(text);
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-6 min-w-[8rem] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle",
            mono && "font-mono text-[13px] placeholder:font-sans",
          )}
        />
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-1 shadow-float"
        >
          {options.map((opt, i) => (
            <li
              key={opt}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(opt);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] text-fg-muted",
                i === active && "bg-white/[0.06] text-fg",
              )}
            >
              <span className={cn("truncate", mono && "font-mono")}>{opt}</span>
              {describe && <span className="shrink-0 text-2xs text-fg-subtle">{describe(opt)}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
