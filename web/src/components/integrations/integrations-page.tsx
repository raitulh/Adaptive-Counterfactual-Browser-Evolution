"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UnplugIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { IdChip, KeyValue, RelativeTime } from "@/components/ui/data-display";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { ErrorState, InlineError } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import type { ConnectionOut } from "@/lib/api";
import { track } from "@/lib/analytics";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { connectionStatusMeta, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { CapabilityPicker } from "./capability-picker";
import { capability, scopesForCapabilities, shortScope, sortCapabilities } from "./google-capabilities";
import { describeConnectionError, parseOAuthReturn, stripOAuthReturnParams, type OAuthReturn } from "./oauth-return";
import { useCheckConnection, useConnectGoogle, useConnections, useDisconnect } from "./queries";

function GoogleMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-3",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-4.5">
        <path
          fill="#EA4335"
          d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
        />
      </svg>
    </span>
  );
}

function LeastPrivilegeNote() {
  const points = [
    "AgentOS requests only the scopes for the capabilities you select, plus your basic identity (openid, email, profile).",
    "Add capabilities later at any time — Google merges the new grant with what you already approved.",
    "Every tool declares the scopes it needs; a tool whose scope isn't granted is blocked before it runs.",
    "Tokens are encrypted at rest and never returned by the API. Sends and other high-risk actions still need your approval.",
  ];
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <ShieldCheckIcon className="size-4 text-success" aria-hidden /> Least-privilege access
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-fg-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestedScopes({ capabilities }: { capabilities: string[] }) {
  const scopes = scopesForCapabilities(capabilities);
  return (
    <p className="text-xs text-fg-subtle">
      Google will ask for: <span className="font-mono text-fg-muted">{scopes.map(shortScope).join(" · ")}</span>
    </p>
  );
}

/** First-time connect: capability selection + least-privilege explanation. */
function ConnectGoogleCard({ canManage }: { canManage: boolean }) {
  const connect = useConnectGoogle();
  const [caps, setCaps] = React.useState<string[]>(["calendar.read", "contacts.read"]);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-line px-5 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <GoogleMark />
          <div>
            <h2 className="text-base font-semibold tracking-tight text-fg">Connect the tools your agents need.</h2>
            <p className="text-[13px] text-fg-muted">Google Workspace — Gmail, Calendar, Drive and Contacts.</p>
          </div>
        </div>
      </div>
      <div className="grid gap-6 px-5 py-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-fg-muted">Choose what agents may do. You can change this later.</p>
          <CapabilityPicker value={caps} onChange={setCaps} disabled={!canManage || connect.isPending} />
        </div>
        <div className="flex flex-col gap-4">
          <LeastPrivilegeNote />
          <div className="flex flex-col gap-2">
            {caps.length > 0 && <RequestedScopes capabilities={caps} />}
            {connect.error && <InlineError error={connect.error} />}
            {canManage ? (
              <Button
                variant="primary"
                size="lg"
                disabled={caps.length === 0}
                loading={connect.isPending}
                onClick={() => connect.mutate({ capabilities: sortCapabilities(caps) })}
              >
                <PlugZapIcon /> Connect Google
              </Button>
            ) : (
              <p className="text-xs text-fg-subtle">Connecting accounts requires the integrations:manage permission.</p>
            )}
            <p className="text-2xs text-fg-subtle">
              You&apos;ll continue on Google&apos;s consent screen and return here.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CapabilitiesDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: ConnectionOut;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const connect = useConnectGoogle();
  const granted = React.useMemo(() => connection.capabilities ?? [], [connection.capabilities]);
  const [caps, setCaps] = React.useState<string[]>(granted);
  const reconnect = connection.status !== "connected";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (connect.isPending) return;
        if (o) setCaps(granted);
        onOpenChange(o);
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{reconnect ? "Reconnect Google" : "Change Google access"}</DialogTitle>
          <DialogDescription>
            {reconnect
              ? "Authorize again on Google's consent screen. Keep the capabilities you need; add or remove others."
              : "Select the capabilities agents should have. Google merges new grants with what you already approved; to drop access entirely, disconnect instead."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <CapabilityPicker value={caps} onChange={setCaps} granted={granted} disabled={connect.isPending} />
          {caps.length > 0 && <RequestedScopes capabilities={caps} />}
          {connect.error && <InlineError error={connect.error} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={connect.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={caps.length === 0}
            loading={connect.isPending}
            onClick={() =>
              connect.mutate({ capabilities: sortCapabilities(caps), loginHint: connection.account_email })
            }
          >
            Continue to Google <ExternalLinkIcon />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionCard({ connection, canManage }: { connection: ConnectionOut; canManage: boolean }) {
  const developerMode = useUiStore((s) => s.developerMode);
  const check = useCheckConnection();
  const disconnect = useDisconnect();
  const [capsOpen, setCapsOpen] = React.useState(false);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [scopesOpen, setScopesOpen] = React.useState(false);
  const meta = connectionStatusMeta[connection.status];
  const needsAction =
    connection.status === "expired" || connection.status === "revoked" || connection.status === "insufficient_scope";
  const isDisconnected = connection.status === "disconnected";
  const errorText = describeConnectionError(connection.last_error_code);
  const caps = connection.capabilities ?? [];
  const scopes = connection.scopes ?? [];

  const onCheck = async () => {
    try {
      const res = await check.mutateAsync(connection.id);
      const m = connectionStatusMeta[res.status];
      if (res.status === "connected")
        toast.success("Connection is working", {
          description: `Tokens refreshed for ${res.account_email ?? "your account"}.`,
        });
      else toast.warning(`Google: ${m.label}`, { description: m.description });
    } catch (err) {
      toastError(err, "Couldn't check the connection");
    }
  };

  return (
    <Card className={cn("overflow-hidden", needsAction && "border-warning/30", isDisconnected && "opacity-80")}>
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <GoogleMark />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Google Workspace</h2>
              <span aria-live="polite">
                <StatusBadge kind="connection" value={connection.status} />
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-fg-muted">{connection.account_email ?? "Unknown account"}</p>
            {developerMode && <IdChip id={connection.id} label="connection" className="mt-1.5" />}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {!isDisconnected && (
              <Button size="sm" variant="secondary" onClick={() => void onCheck()} loading={check.isPending}>
                <RefreshCwIcon /> Check now
              </Button>
            )}
            <Button
              size="sm"
              variant={needsAction || isDisconnected ? "primary" : "secondary"}
              onClick={() => setCapsOpen(true)}
            >
              <KeyRoundIcon /> {needsAction || isDisconnected ? "Reconnect" : "Add capabilities"}
            </Button>
            {!isDisconnected && (
              <Button size="sm" variant="danger-outline" onClick={() => setDisconnectOpen(true)}>
                <UnplugIcon /> Disconnect
              </Button>
            )}
          </div>
        )}
        {!canManage && !isDisconnected && (
          <Button size="sm" variant="secondary" onClick={() => void onCheck()} loading={check.isPending}>
            <RefreshCwIcon /> Check now
          </Button>
        )}
      </div>

      {(needsAction || connection.status === "temporarily_unavailable") && (
        <div
          role="status"
          className={cn(
            "mx-5 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] sm:mx-6",
            toneClasses[meta.tone].border,
            toneClasses[meta.tone].soft,
          )}
        >
          <AlertTriangleIcon className={cn("mt-0.5 size-4 shrink-0", toneClasses[meta.tone].text)} aria-hidden />
          <p className="text-fg-muted">
            <span className="font-medium text-fg">{meta.label}.</span> {meta.description}
            {errorText && <span className="block text-xs text-fg-subtle">{errorText}</span>}
          </p>
        </div>
      )}

      <div className="grid gap-5 border-t border-line px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs text-fg-subtle">
              {isDisconnected ? "Capabilities before disconnecting (no longer usable)" : "Capabilities"}
            </p>
            {caps.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                {isDisconnected ? "None — disconnected." : "Identity only; no Workspace access granted."}
              </p>
            ) : (
              <ul className={cn("flex flex-wrap gap-1.5", isDisconnected && "opacity-60")}>
                {caps.map((c) => (
                  <li key={c}>
                    <Badge
                      tone={capability(c)?.access === "write" ? "info" : "neutral"}
                      variant="outline"
                      size="md"
                      title={capability(c)?.description}
                    >
                      {capability(c)?.label ?? c}
                      <span className="font-mono text-2xs text-fg-subtle">{c}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {scopes.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setScopesOpen((o) => !o)}
                aria-expanded={scopesOpen}
                className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
              >
                {isDisconnected ? "Previously granted scopes" : "Granted scopes"} ({scopes.length})
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", scopesOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
              {scopesOpen && (
                <ul className="mt-2 flex flex-col gap-1">
                  {scopes.map((s) => (
                    <li key={s} className="font-mono text-2xs break-all text-fg-muted">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <KeyValue
          className="grid-cols-[minmax(7rem,auto)_1fr] text-xs"
          items={[
            [
              "Access token",
              connection.token_expires_at ? (
                <span key="e" title={dateTime(connection.token_expires_at)}>
                  expires <RelativeTime value={connection.token_expires_at} />
                </span>
              ) : (
                <span key="e" className="text-fg-subtle">
                  —
                </span>
              ),
            ],
            ["Last refreshed", <RelativeTime key="r" value={connection.last_refreshed_at} />],
            [
              isDisconnected ? "Disconnected" : "Connected",
              <RelativeTime key="c" value={isDisconnected ? connection.disconnected_at : connection.connected_at} />,
            ],
            ...(connection.last_error_code
              ? ([
                  [
                    "Last error",
                    <span key="le">
                      <span className="font-mono text-danger">{connection.last_error_code}</span>
                      {errorText && !needsAction && <span className="block text-fg-muted">{errorText}</span>}
                    </span>,
                  ],
                ] as Array<[React.ReactNode, React.ReactNode]>)
              : []),
          ]}
        />
      </div>

      {canManage && <CapabilitiesDialog connection={connection} open={capsOpen} onOpenChange={setCapsOpen} />}
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        tone="danger"
        title={`Disconnect ${connection.account_email ?? "this Google account"}?`}
        description="AgentOS deletes its stored tokens for this account and asks Google to revoke the grant. Agents immediately lose access to Gmail, Calendar, Drive and Contacts; tasks that need them are blocked until you reconnect. Nothing in your Google account is deleted."
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
        onConfirm={async () => {
          try {
            await disconnect.mutateAsync(connection.id);
            toast.success("Google disconnected", {
              description: "Tokens were deleted and revocation was requested at Google.",
            });
            setDisconnectOpen(false);
          } catch (err) {
            toastError(err, "Couldn't disconnect");
          }
        }}
      />
    </Card>
  );
}

function ReturnBanner({ value, onDismiss }: { value: Extract<OAuthReturn, { kind: "error" }>; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/[0.07] px-4 py-3"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-medium text-fg">{value.title}</p>
        <p className="mt-0.5 text-fg-muted">{value.message}</p>
        <p className="mt-1 font-mono text-2xs text-fg-subtle">reason: {value.reason}</p>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </Button>
    </div>
  );
}

export function IntegrationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("integrations:manage");
  const q = useConnections();

  // The backend callback redirects here with ?status=connected | ?status=error&reason=…
  const [returned, setReturned] = React.useState<OAuthReturn | null>(() => parseOAuthReturn(params));
  const handled = React.useRef<string | null>(null);
  React.useEffect(() => {
    const ret = parseOAuthReturn(params);
    if (!ret) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;
    if (ret.kind === "connected") {
      toast.success("Google connected", { description: "Agents can now use the capabilities you granted." });
      track("integration_connected", { provider: "google" });
      void qc.invalidateQueries({ queryKey: qk.integrations.all });
      void qc.invalidateQueries({ queryKey: qk.tools.all });
    } else {
      toast.error(ret.title, { description: ret.message });
    }
    router.replace(stripOAuthReturnParams(pathname, new URLSearchParams(params.toString())), { scroll: false });
  }, [params, pathname, qc, router]);

  const connections = q.data ?? [];
  const active = connections.filter((c) => c.status !== "disconnected");
  const past = connections.filter((c) => c.status === "disconnected");

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Accounts your agents act on. AgentOS requests the narrowest Google scopes for the capabilities you choose and keeps tokens encrypted."
      />
      {returned?.kind === "error" && <ReturnBanner value={returned} onDismiss={() => setReturned(null)} />}

      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
          <Skeleton className="h-32 w-full" />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {active.length === 0 && <ConnectGoogleCard canManage={canManage} />}
          {active.map((c) => (
            <ConnectionCard key={c.id} connection={c} canManage={canManage} />
          ))}
          {past.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Previously connected</h2>
              {past.map((c) => (
                <ConnectionCard key={c.id} connection={c} canManage={canManage} />
              ))}
            </section>
          )}
          {active.length > 0 && <LeastPrivilegeNote />}
        </div>
      )}
    </PageContainer>
  );
}
