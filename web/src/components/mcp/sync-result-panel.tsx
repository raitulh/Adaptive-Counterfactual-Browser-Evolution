"use client";

import { AlertTriangleIcon, CheckCircle2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { McpSyncResult } from "@/lib/api";
import { clockTime } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { summarizeSync } from "./mcp-review";

export function SyncResultPanel({ result, at, onDismiss }: { result: McpSyncResult; at: number; onDismiss: () => void }) {
  const s = summarizeSync(result);
  return (
    <Card role="status" aria-live="polite" className={cn("overflow-hidden", s.suspicious ? "border-danger/35" : "border-line-strong")}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-start gap-2.5">
          {s.suspicious ? (
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          )}
          <div>
            <p className="text-[13px] font-medium text-fg">
              Sync result <span className="font-normal text-fg-subtle">· {clockTime(at)}</span>
            </p>
            <p className="text-xs text-fg-muted">
              {s.changed === 0 ? "No changes since the last sync." : `${s.changed} ${s.changed === 1 ? "change" : "changes"}.`}
              {s.suspicious && " Changed or rejected tools need your attention before agents can use them."}
              {s.truncated && " The server advertised more tools than the gateway accepts; the list was truncated."}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss sync result" onClick={onDismiss}>
          <XIcon />
        </Button>
      </div>
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2 xl:grid-cols-3">
        {s.groups.map((g) => (
          <section key={g.key} aria-label={g.label} className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={g.tone}>
                {g.label} · {g.items.length}
              </Badge>
            </div>
            <p className="mt-1 text-2xs text-fg-subtle">{g.description}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {g.items.slice(0, 12).map((it) => (
                <li key={it.name} className="min-w-0">
                  <span className={cn("block truncate font-mono text-xs", g.key === "unchanged" ? "text-fg-subtle" : "text-fg")}>{it.name}</span>
                  {it.reason && <span className={cn("block text-2xs", toneClasses.danger.text)}>{it.reason}</span>}
                </li>
              ))}
              {g.items.length > 12 && <li className="text-2xs text-fg-subtle">+{g.items.length - 12} more</li>}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
