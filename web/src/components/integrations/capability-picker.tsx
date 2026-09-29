"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/controls";
import { cn } from "@/lib/utils";
import { GOOGLE_CAPABILITIES, GOOGLE_PRODUCTS, shortScope, type GoogleCapability } from "./google-capabilities";

function ProductIcon({ product }: { product: string }) {
  const letter = { gmail: "M", calendar: "31", drive: "D", contacts: "C" }[product] ?? "G";
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface-3 font-mono text-2xs font-semibold text-fg-muted"
      aria-hidden
    >
      {letter}
    </span>
  );
}

function CapabilityOption({
  cap,
  checked,
  granted,
  onChange,
  disabled,
}: {
  cap: GoogleCapability;
  checked: boolean;
  granted: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-surface-1",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="mt-0.5"
        aria-describedby={`${id}-d`}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-medium text-fg">
          {cap.label}
          <span className="font-mono text-2xs font-normal text-fg-subtle">{cap.id}</span>
          <span
            className={cn("rounded px-1 text-2xs font-normal", cap.access === "read" ? "text-fg-subtle" : "text-info")}
          >
            {cap.access === "read" ? "read-only" : "write"}
          </span>
          {granted && <span className="text-2xs font-normal text-success">granted</span>}
        </label>
        <p id={`${id}-d`} className="mt-0.5 text-xs text-fg-muted">
          {cap.description}
          {cap.note && <span className="block text-fg-subtle">{cap.note}</span>}
        </p>
        <p className="mt-1 font-mono text-2xs break-all text-fg-subtle">
          scope: {cap.scopes.map(shortScope).join(", ")}
        </p>
      </div>
    </div>
  );
}

/** Capability checklist grouped by Google product, showing the exact scope each one requests. */
export function CapabilityPicker({
  value,
  onChange,
  granted = [],
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  granted?: string[];
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(GOOGLE_CAPABILITIES.map((c) => c.id).filter((c) => next.has(c)));
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GOOGLE_PRODUCTS.map((p) => (
        <fieldset key={p.id} className="flex flex-col gap-2">
          <legend className="mb-2 flex items-center gap-2.5">
            <ProductIcon product={p.id} />
            <span>
              <span className="block text-[13px] font-semibold text-fg">{p.label}</span>
              <span className="block text-xs text-fg-subtle">{p.description}</span>
            </span>
          </legend>
          {GOOGLE_CAPABILITIES.filter((c) => c.product === p.id).map((c) => (
            <CapabilityOption
              key={c.id}
              cap={c}
              checked={selected.has(c.id)}
              granted={granted.includes(c.id)}
              onChange={(on) => toggle(c.id, on)}
              disabled={disabled}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
