"use client";

import { useQuery } from "@tanstack/react-query";
import { approvalsApi, notificationsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";

/**
 * Counts for navigation badges. Kept fresh by the user stream (invalidation); a slow background
 * refetch covers a degraded stream. Counts are capped client-side ("50+") — the lists are paginated.
 */
const CAP = 50;

export function usePendingApprovalsCount() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.approvals.pendingCount,
    queryFn: async ({ signal }) => {
      const page = await approvalsApi.list({ status: "pending", limit: CAP }, { signal });
      return { count: page.items.length, more: page.has_more };
    },
    enabled: status === "authenticated",
    refetchInterval: 120_000,
    staleTime: 15_000,
  });
}

export function useUnreadNotificationsCount() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.notifications.unreadCount,
    queryFn: async ({ signal }) => {
      const page = await notificationsApi.list({ unread_only: true, limit: CAP }, { signal });
      return { count: page.items.length, more: page.has_more };
    },
    enabled: status === "authenticated",
    refetchInterval: 120_000,
    staleTime: 15_000,
  });
}

export function formatCount(data: { count: number; more?: boolean } | undefined): string | null {
  if (!data || data.count === 0) return null;
  return data.more ? `${CAP}+` : String(data.count);
}
