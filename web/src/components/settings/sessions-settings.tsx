"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon, ChevronDownIcon, LaptopIcon, LogOutIcon, MonitorSmartphoneIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import { authApi, type SessionOut } from "@/lib/api";
import { useAuth } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { SettingsCard } from "./settings-layout";
import { useNow } from "./use-now";
import { authMethodLabel, summarizeUserAgent } from "./user-agent";

export function isSessionActive(s: SessionOut, now: number): boolean {
  return !s.revoked_at && new Date(s.expires_at).getTime() > now;
}

export function SessionsSettings() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => authApi.sessions(), staleTime: 15_000 });
  const [target, setTarget] = React.useState<SessionOut | null>(null);
  const [confirmOthers, setConfirmOthers] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(false);
  const now = useNow();

  const all = sessions.data ?? [];
  const active = all.filter((s) => isSessionActive(s, now)).sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)));
  const inactive = all.filter((s) => !isSessionActive(s, now));
  const others = active.filter((s) => !s.current);

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      toast.success("Session signed out");
      setTarget(null);
    },
    onError: (err) => toastError(err, "Couldn't sign out that session"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.sessions }),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      let failed = 0;
      for (const s of others) {
        try {
          await authApi.revokeSession(s.id);
        } catch {
          failed++;
        }
      }
      return { total: others.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      setConfirmOthers(false);
      if (failed) toast.error(`Signed out ${total - failed} of ${total} sessions`, { description: "Some sessions could not be revoked. Try again." });
      else toast.success(total === 1 ? "Signed out 1 other session" : `Signed out ${total} other sessions`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.sessions }),
  });

  if (sessions.error) return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Active sessions"
        description="Devices and apps currently signed in to your account. Signing a session out revokes it immediately; the device has to sign in again."
        actions={
          others.length > 0 ? (
            <Button variant="danger-outline" size="sm" onClick={() => setConfirmOthers(true)}>
              <LogOutIcon /> Sign out all other sessions
            </Button>
          ) : null
        }
      >
        {sessions.isLoading ? (
          <div className="flex flex-col divide-y divide-line" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState size="sm" icon={<MonitorSmartphoneIcon />} title="No active sessions" description="Sessions appear here when you sign in on a device." />
        ) : (
          <ul className="-my-1 flex flex-col divide-y divide-line">
            {active.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                now={now}
                action={
                  s.current ? (
                    <Tooltip content="This is the session you're using. Signing it out signs you out here.">
                      <Button variant="ghost" size="sm" onClick={() => void logout()}>
                        Sign out
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button variant="danger-outline" size="sm" onClick={() => setTarget(s)} aria-label={`Sign out ${summarizeUserAgent(s.user_agent).label}`}>
                      Revoke
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      {inactive.length > 0 && (
        <SettingsCard
          title="Recently ended"
          description="Sessions that were signed out, revoked or expired. Kept for your reference."
          actions={
            <Button variant="ghost" size="sm" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive}>
              {showInactive ? "Hide" : `Show ${inactive.length}`}
              <ChevronDownIcon className={cn("transition-transform", showInactive && "rotate-180")} />
            </Button>
          }
        >
          {showInactive ? (
            <ul className="-my-1 flex flex-col divide-y divide-line">
              {inactive.map((s) => (
                <SessionRow key={s.id} session={s} muted now={now} />
              ))}
            </ul>
          ) : null}
        </SettingsCard>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        tone="danger"
        title="Sign out this session?"
        description={
          target ? (
            <>
              <span className="font-medium text-fg">{target.device_name || summarizeUserAgent(target.user_agent).label}</span>
              {target.ip_address ? ` (${target.ip_address})` : ""} will be signed out immediately.
            </>
          ) : null
        }
        confirmLabel="Sign out session"
        loading={revoke.isPending}
        onConfirm={() => {
          if (target) revoke.mutate(target.id);
        }}
      />
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        tone="danger"
        title={`Sign out ${others.length} other ${others.length === 1 ? "session" : "sessions"}?`}
        description="Every device except this one is signed out immediately. You stay signed in here."
        confirmLabel="Sign out others"
        loading={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate()}
      />
    </div>
  );
}

function DeviceIcon({ device }: { device: ReturnType<typeof summarizeUserAgent>["device"] }) {
  const Icon = device === "mobile" ? SmartphoneIcon : device === "tablet" ? TabletIcon : device === "bot" ? BotIcon : LaptopIcon;
  return <Icon className="size-4" aria-hidden />;
}

function SessionRow({ session: s, action, muted, now }: { session: SessionOut; action?: React.ReactNode; muted?: boolean; now: number }) {
  const developerMode = useUiStore((st) => st.developerMode);
  const ua = summarizeUserAgent(s.user_agent);
  const title = s.device_name || ua.label;
  const ended = s.revoked_at ? `Signed out ${dateTime(s.revoked_at)}` : new Date(s.expires_at).getTime() <= now ? `Expired ${dateTime(s.expires_at)}` : null;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            s.current ? "border-accent/30 bg-accent/10 text-accent" : "border-line-strong bg-surface-2 text-fg-muted",
          )}
        >
          <DeviceIcon device={ua.device} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("truncate text-sm font-medium", muted ? "text-fg-muted" : "text-fg")}>{title}</span>
            {s.current && (
              <Badge tone="accent" variant="soft">
                This device
              </Badge>
            )}
            <Badge tone="neutral" variant="outline">
              {authMethodLabel(s.auth_method)}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            {s.device_name && s.user_agent ? (
              <Tooltip content={<span className="break-all font-mono text-2xs">{s.user_agent}</span>}>
                <span tabIndex={0} className="outline-none">
                  {ua.label}
                </span>
              </Tooltip>
            ) : s.user_agent ? (
              <Tooltip content={<span className="break-all font-mono text-2xs">{s.user_agent}</span>}>
                <span tabIndex={0} className="outline-none underline decoration-dotted underline-offset-2">
                  User agent
                </span>
              </Tooltip>
            ) : null}
            {s.ip_address && <span className="font-mono">{s.ip_address}</span>}
            <span>
              Signed in <RelativeTime value={s.created_at} />
            </span>
            {!ended && (
              <span>
                Last active <RelativeTime value={s.last_seen_at} />
              </span>
            )}
            {!ended && (
              <span>
                Expires <RelativeTime value={s.expires_at} />
              </span>
            )}
            {ended && <span>{ended}</span>}
            {developerMode && <span className="font-mono text-2xs">id {s.id}</span>}
          </div>
        </div>
      </div>
      {action && <div className="flex shrink-0 justify-end pl-12 sm:pl-0">{action}</div>}
    </li>
  );
}
