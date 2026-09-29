"use client";

import { CheckIcon, ChevronsUpDownIcon, GlobeIcon } from "lucide-react";
import * as React from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** IANA time zones known to this browser (falls back to a short list on old engines). */
export function listTimeZones(current?: string | null): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dhaka", "Asia/Tokyo", "Australia/Sydney"];
  }
  const set = new Set(zones);
  set.add("UTC");
  if (current) set.add(current);
  return [...set].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

/** "GMT+2" style offset for a zone right now (empty string if the engine can't tell). */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** Searchable IANA time zone picker (combobox). */
export function TimezoneSelect({
  value,
  onChange,
  id,
  disabled,
  ...aria
}: {
  value: string;
  onChange: (zone: string) => void;
  id?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const zones = React.useMemo(() => (open ? listTimeZones(value) : []), [open, value]);
  const offsets = React.useMemo(() => {
    const now = new Date();
    return new Map(zones.map((z) => [z, zoneOffset(z, now)]));
  }, [zones]);
  const detected = browserTimeZone();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        {...aria}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-1 px-3 text-left text-sm text-fg outline-none transition-colors focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50 aria-[invalid=true]:border-danger/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <GlobeIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{value || "Select a time zone"}</span>
          {value && <span className="shrink-0 text-xs text-fg-subtle">{zoneOffset(value)}</span>}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().replace(/_/g, " ").includes(search.toLowerCase().replace(/_/g, " ")) ? 1 : 0)}
        >
          <CommandInput placeholder="Search time zones…" aria-label="Search time zones" />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching time zone.</CommandEmpty>
            {detected && detected !== value && (
              <CommandItem
                value={`detected ${detected}`}
                onSelect={() => {
                  onChange(detected);
                  setOpen(false);
                }}
                className="text-accent"
              >
                <GlobeIcon />
                <span className="flex-1 truncate">Use this device&apos;s time zone ({detected})</span>
              </CommandItem>
            )}
            {zones.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
              >
                <CheckIcon className={cn("text-accent", zone === value ? "opacity-100" : "opacity-0")} aria-hidden />
                <span className="flex-1 truncate">{zone.replace(/_/g, " ")}</span>
                <span className="text-2xs tabular-nums text-fg-subtle">{offsets.get(zone)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
