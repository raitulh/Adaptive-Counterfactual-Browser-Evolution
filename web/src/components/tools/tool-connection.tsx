"use client";

import { CheckCircle2Icon, LinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toastError } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import type { ConnectionOut, ToolOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { connectionStatusMeta } from "@/lib/status";
import { capabilitiesForScopes, sortCapabilities } from "@/components/integrations/google-capabilities";
import { activeGoogleConnection, useConnections } from "@/components/integrations/queries";
import { useConnectToolProvider } from "./queries";

export interface ToolAccess {
  /** Capabilities the tool's required scopes map to. */
  needed: string[];
  /** Needed capabilities the active connection does not have. */
  missing: string[];
  connection?: ConnectionOut;
  /** A working connection covers every needed capability. */
  ready: boolean;
}

export function toolAccess(tool: Pick<ToolOut, "provider" | "required_scopes">, connections: readonly ConnectionOut[] | undefined): ToolAccess | null {
  if (tool.provider !== "google" || tool.required_scopes.length === 0) return null;
  const needed = capabilitiesForScopes(tool.required_scopes);
  const connection = activeGoogleConnection(connections);
  const have = new Set(connection?.capabilities ?? []);
  const missing = needed.filter((c) => !have.has(c));
  return { needed, missing, connection, ready: connection?.status === "connected" && missing.length === 0 };
}

/** Connection state for a Google-backed tool, with a connect action that requests exactly what is missing. */
export function ToolConnectionStatus({ tool, compact }: { tool: ToolOut; compact?: boolean }) {
  const { can } = usePermissions();
  const connections = useConnections();
  const connect = useConnectToolProvider();
  const access = toolAccess(tool, connections.data);
  if (!access || connections.isLoading) return null;

  if (access.ready) {
    return (
      <Tooltip content={`Connected as ${access.connection?.account_email ?? "your Google account"}`}>
        <Badge tone="success" className="cursor-default" tabIndex={0}>
          <CheckCircle2Icon className="size-3" aria-hidden /> Connected
        </Badge>
      </Tooltip>
    );
  }

  const status = access.connection?.status;
  const problem = status && status !== "connected" ? connectionStatusMeta[status].label : null;
  const label = problem ? `Google: ${problem}` : access.connection ? `Needs ${access.missing.join(", ")}` : "Google not connected";

  if (!can("integrations:manage")) {
    return (
      <Badge tone="warning" title="Ask someone with integrations:manage to connect Google.">
        {label}
      </Badge>
    );
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      loading={connect.isPending}
      onClick={(e) => {
        e.stopPropagation();
        // Keep what is already granted and add what this tool needs (Google merges incremental grants).
        const capabilities = sortCapabilities([...(access.connection?.capabilities ?? []), ...access.needed]);
        connect.mutate({ provider: "google", capabilities }, { onError: (err) => toastError(err, "Couldn't start the Google connection") });
      }}
      aria-label={`${problem ? "Reconnect" : "Connect"} Google for ${tool.name} (${access.needed.join(", ")})`}
      title={label}
      className={compact ? "h-6 px-2 text-2xs" : undefined}
    >
      <LinkIcon /> {problem ? "Reconnect" : access.connection ? "Grant access" : "Connect"}
    </Button>
  );
}
