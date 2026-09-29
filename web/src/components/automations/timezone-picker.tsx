"use client";

import { CheckIcon, ChevronsUpDownIcon, GlobeIcon } from "lucide-react";
import * as React from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { browserTimeZone, listTimeZones, zoneOffsetLabel } from "./schedule";

/** Searchable IANA time zone picker (browser list via Intl, curated fallback). */
export function TimezonePicker({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (zone: string) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const zones = React.useMemo(() => listTimeZones(), []);
  const local = React.useMemo(() => browserTimeZone(), []);
  const offset = React.useMemo(() => zoneOffsetLabel(value), [value]);
  const listId = React.useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-1 px-3 text-left text-sm text-fg outline-none transition-colors focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 aria-[invalid=true]:border-danger/60"
        >
          <span className="flex min-w-0 items-center gap-2">
            <GlobeIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <span className="truncate">{value.replace(/_/g, " ")}</span>
            {offset && <span className="shrink-0 font-mono text-2xs text-fg-subtle">{offset}</span>}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().replace(/_/g, " ").includes(search.toLowerCase().trim()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search time zones…" aria-label="Search time zones" />
          <CommandList id={listId} className="max-h-72">
            <CommandEmpty>No matching time zone.</CommandEmpty>
            {local !== "UTC" && (
              <CommandGroup heading="Suggested">
                {[local, "UTC"].map((z) => (
                  <ZoneItem key={`s-${z}`} zone={z} selected={z === value} onSelect={(v) => (onChange(v), setOpen(false))} hint={z === local ? "Your time zone" : "Universal"} />
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="All time zones">
              {zones.map((z) => (
                <ZoneItem key={z} zone={z} selected={z === value} onSelect={(v) => (onChange(v), setOpen(false))} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ZoneItem({ zone, selected, onSelect, hint }: { zone: string; selected: boolean; onSelect: (z: string) => void; hint?: string }) {
  return (
    <CommandItem value={hint !== undefined ? `${zone} · ${hint}` : zone} onSelect={() => onSelect(zone)}>
      <CheckIcon className={cn("size-4", selected ? "text-accent opacity-100" : "opacity-0")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{zone.replace(/_/g, " ")}</span>
      {hint && <span className="text-2xs text-fg-subtle">{hint}</span>}
    </CommandItem>
  );
}
