"use client";

import { useQuery } from "@tanstack/react-query";
import { BotIcon, Building2Icon, CodeIcon, ListChecksIcon, PlusIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { StatusBadge } from "@/components/ui/badge";
import { SETTINGS_ITEM } from "@/config/navigation";
import { track } from "@/lib/analytics";
import { agentsApi, approvalsApi, tasksApi } from "@/lib/api";
import { useOrganization, usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { useUiStore } from "@/stores/ui";
import { useVisibleNav } from "./sidebar";

/**
 * Global command palette (⌘K / Ctrl+K). Navigates across resources the user can see; for content
 * search it hands off to the real Search page rather than pretending to replace backend search.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const next = !useUiStore.getState().commandOpen;
        setOpen(next);
        if (next) track("command_palette_opened");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-[12dvh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong shadow-float outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <PaletteContent />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Mounted only while the palette is open, so its query state resets on every open. */
function PaletteContent() {
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const focusComposer = useUiStore((s) => s.focusComposer);
  const developerMode = useUiStore((s) => s.developerMode);
  const setDeveloperMode = useUiStore((s) => s.setDeveloperMode);
  const router = useRouter();
  const sections = useVisibleNav();
  const { can } = usePermissions();
  const { organizations, tenantId, switchOrganization } = useOrganization();
  const [query, setQuery] = useState("");

  const recentTasks = useQuery({
    queryKey: qk.tasks.list({ limit: 8 }),
    queryFn: ({ signal }) => tasksApi.list({ limit: 8 }, { signal }),
    enabled: can("tasks:read"),
    staleTime: 15_000,
  });
  const agents = useQuery({
    queryKey: qk.agents.list,
    queryFn: ({ signal }) => agentsApi.list({ limit: 50 }, { signal }),
    enabled: can("agents:read"),
    staleTime: 60_000,
  });
  const pending = useQuery({
    queryKey: qk.approvals.list({ status: "pending", limit: 8 }),
    queryFn: ({ signal }) => approvalsApi.list({ status: "pending", limit: 8 }, { signal }),
    staleTime: 10_000,
  });

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Command loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="new task give agentos a goal"
            onSelect={() => {
              go("/app");
              setTimeout(focusComposer, 50);
            }}
          >
            <PlusIcon /> New task
          </CommandItem>
          {query.trim() && (
            <CommandItem
              value={`search web documents ${query}`}
              onSelect={() => go(`/app/search?q=${encodeURIComponent(query.trim())}`)}
            >
              <SearchIcon /> Search for “{query.trim()}”
            </CommandItem>
          )}
          <CommandItem value="toggle developer details advanced" onSelect={() => setDeveloperMode(!developerMode)}>
            <CodeIcon /> {developerMode ? "Hide" : "Show"} developer details
          </CommandItem>
        </CommandGroup>

        {(pending.data?.items.length ?? 0) > 0 && (
          <CommandGroup heading="Waiting for your approval">
            {pending.data!.items.map((a) => (
              <CommandItem
                key={a.id}
                value={`approve ${a.summary} ${a.tool_name} ${a.id}`}
                onSelect={() => go(`/app/approvals?focus=${a.id}`)}
              >
                <ShieldCheckIcon className="text-warning" />
                <span className="truncate">{a.summary}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(recentTasks.data?.items.length ?? 0) > 0 && (
          <CommandGroup heading="Recent tasks">
            {recentTasks.data!.items.map((t) => (
              <CommandItem
                key={t.task_id}
                value={`task ${t.goal} ${t.task_id}`}
                onSelect={() => go(`/app/tasks/${t.task_id}`)}
              >
                <ListChecksIcon />
                <span className="min-w-0 flex-1 truncate">{t.goal}</span>
                <StatusBadge kind="task" value={t.status} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(agents.data?.items.length ?? 0) > 0 && (
          <CommandGroup heading="Agents">
            {agents.data!.items.map((a) => (
              <CommandItem key={a.id} value={`agent ${a.name} ${a.id}`} onSelect={() => go(`/app/agents/${a.id}`)}>
                <BotIcon /> {a.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Go to">
          {sections
            .flatMap((s) => s.items)
            .concat(SETTINGS_ITEM)
            .map((item) => (
              <CommandItem
                key={item.href}
                value={`go ${item.label} ${(item.keywords ?? []).join(" ")}`}
                onSelect={() => go(item.href)}
              >
                <item.icon /> {item.label}
              </CommandItem>
            ))}
        </CommandGroup>

        {organizations.length > 1 && (
          <CommandGroup heading="Switch organization">
            {organizations
              .filter((o) => o.id !== tenantId)
              .map((o) => (
                <CommandItem
                  key={o.id}
                  value={`switch organization ${o.name}`}
                  onSelect={() => {
                    setOpen(false);
                    void switchOrganization(o.id);
                  }}
                >
                  <Building2Icon /> {o.name}
                </CommandItem>
              ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
