"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon, UserCheckIcon, UserXIcon, UsersIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IdChip, RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import { adminApi, type AdminUserOut } from "@/lib/api";
import { useCurrentUser } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useUiStore } from "@/stores/ui";
import { AdminSection } from "./admin-shell";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  active: "success",
  disabled: "danger",
  deletion_pending: "warning",
  deleted: "neutral",
};

export function AdminUsers() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const developerMode = useUiStore((s) => s.developerMode);
  const me = useCurrentUser();
  const email = params.get("email")?.trim() ?? "";
  const [draft, setDraft] = React.useState(email);
  const [synced, setSynced] = React.useState(email);
  if (synced !== email) {
    setSynced(email);
    setDraft(email);
  }
  const [target, setTarget] = React.useState<AdminUserOut | null>(null);

  // Debounce typing into the URL (the URL is the source of truth for the search).
  React.useEffect(() => {
    const v = draft.trim();
    if (v === email) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (v) next.set("email", v);
      else next.delete("email");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [draft, email, params, pathname, router]);

  const query = { email: email || null, limit: 100 };
  const users = useQuery({
    queryKey: qk.admin.users(query),
    queryFn: ({ signal }) => adminApi.users(query, { signal }),
    placeholderData: (p) => p,
  });

  const columns: Column<AdminUserOut>[] = [
    {
      id: "user",
      header: "User",
      cell: (u) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-fg">{u.email}</span>
            {u.id === me.data?.id && <Badge tone="accent">You</Badge>}
            {u.is_platform_admin && <Badge tone="verify">Platform admin</Badge>}
          </div>
          {developerMode && <IdChip id={u.id} className="mt-1" />}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (u) => <Badge tone={STATUS_TONE[u.status] ?? "neutral"}>{humanize(u.status)}</Badge>,
    },
    {
      id: "mfa",
      header: "2-step",
      hideBelow: "sm",
      cell: (u) => (
        <span className={u.mfa_enabled ? "text-success" : "text-fg-subtle"}>{u.mfa_enabled ? "On" : "Off"}</span>
      ),
    },
    {
      id: "created",
      header: "Joined",
      hideBelow: "md",
      cell: (u) => <RelativeTime value={u.created_at} className="text-fg-muted" />,
    },
    {
      id: "login",
      header: "Last sign-in",
      hideBelow: "lg",
      cell: (u) =>
        u.last_login_at ? (
          <RelativeTime value={u.last_login_at} className="text-fg-muted" />
        ) : (
          <span className="text-fg-subtle">Never</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      cell: (u) => {
        const self = u.id === me.data?.id;
        const canToggle = u.status === "active" || u.status === "disabled";
        if (!canToggle) return null;
        const btn =
          u.status === "active" ? (
            <Button
              variant="outline"
              size="xs"
              disabled={self}
              onClick={() => setTarget(u)}
              className="hover:border-danger/40 hover:text-danger"
            >
              <UserXIcon /> Suspend
            </Button>
          ) : (
            <Button variant="outline" size="xs" onClick={() => setTarget(u)}>
              <UserCheckIcon /> Reactivate
            </Button>
          );
        return self ? (
          <Tooltip content="You can't change your own status.">
            <span className="inline-flex">{btn}</span>
          </Tooltip>
        ) : (
          btn
        );
      },
    },
  ];

  return (
    <AdminSection
      title="Users"
      description="Every account on the platform. Suspending a user signs them out everywhere immediately and blocks sign-in until reactivated."
      actions={
        <div className="relative w-full sm:w-72">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by e-mail"
            className="h-8 pl-8"
            aria-label="Search users by e-mail"
            type="search"
          />
        </div>
      }
    >
      <DataTable
        caption="Platform users"
        columns={columns}
        rows={users.data ?? []}
        rowKey={(u) => u.id}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => void users.refetch()}
        className={users.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}
        empty={
          <EmptyState
            size="sm"
            icon={<UsersIcon />}
            title={email ? `No users match “${email}”` : "No users yet"}
            description={email ? "Search matches any part of the e-mail address." : undefined}
          />
        }
      />
      {users.data && users.data.length >= 100 && (
        <p className="text-xs text-fg-subtle">Showing the 100 most recent matches. Refine the search to find others.</p>
      )}
      <StatusDialog user={target} onClose={() => setTarget(null)} />
    </AdminSection>
  );
}

function StatusDialog({ user, onClose }: { user: AdminUserOut | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState("");
  const suspend = user?.status === "active";
  const update = useMutation({
    mutationFn: () => adminApi.updateUser(user!.id, { status: suspend ? "disabled" : "active", reason: reason.trim() }),
    onSuccess: (u) => {
      toast.success(
        suspend ? `${u.email} suspended` : `${u.email} reactivated`,
        suspend ? { description: "All of their sessions were revoked." } : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setReason("");
      onClose();
    },
  });
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(o) => {
        if (!o && !update.isPending) {
          setReason("");
          update.reset();
          onClose();
        }
      }}
    >
      <DialogContent size="sm" className={suspend ? "border-danger/35" : undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) update.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle className={suspend ? "text-danger" : undefined}>
              {suspend ? "Suspend this user?" : "Reactivate this user?"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-fg">{user?.email}</span>{" "}
              {suspend
                ? "is signed out of every device and can't sign in until reactivated. Their data is kept."
                : "can sign in again. Previous sessions stay revoked."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Reason" required description="Recorded in the audit log.">
              {(ids) => (
                <Textarea
                  {...ids}
                  autoFocus
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
            {update.error ? <InlineError className="mt-3" error={update.error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={suspend ? "danger" : "primary"}
              loading={update.isPending}
              disabled={!reason.trim()}
            >
              {suspend ? "Suspend user" : "Reactivate user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
