"use client";

import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toastError } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import { useOrganization } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The active organization is always visible; switching clears all cached data (tenant isolation). */
export function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { organization, organizations, tenantId, switchOrganization } = useOrganization();
  const [switching, setSwitching] = useState<string | null>(null);
  const name = organization?.name ?? "Organization";

  const trigger = (
    <DropdownMenuTrigger
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border border-line bg-surface-2/70 px-2 py-1.5 text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/50",
        collapsed && "size-9 justify-center p-0",
      )}
      aria-label={`Active organization: ${name}. Switch organization`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-accent/12 text-2xs font-bold uppercase text-accent">
        {name.slice(0, 1)}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
            <span className="block truncate text-2xs text-fg-subtle">
              {organization ? `${humanize(organization.plan)} plan${organization.role ? ` · ${humanize(organization.role)}` : ""}` : "Loading…"}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        </>
      )}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip content={name} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" side={collapsed ? "right" : "top"} className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            disabled={org.id === tenantId || switching !== null}
            onSelect={async (e) => {
              e.preventDefault();
              if (org.id === tenantId) return;
              setSwitching(org.id);
              try {
                await switchOrganization(org.id);
              } catch (err) {
                toastError(err, "Couldn't switch organization");
              } finally {
                setSwitching(null);
              }
            }}
          >
            <Building2Icon />
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {org.id === tenantId && <CheckIcon className="text-accent" aria-label="Active" />}
            {switching === org.id && <span className="text-2xs text-fg-subtle">Switching…</span>}
          </DropdownMenuItem>
        ))}
        {organizations.length === 0 && <div className="px-2 py-1.5 text-xs text-fg-subtle">Loading…</div>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/app/settings/organization">Organization settings</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
