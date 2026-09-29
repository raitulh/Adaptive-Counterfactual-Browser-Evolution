"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useMemo } from "react";
import { organizationsApi, usersApi, type PermissionCode } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { AuthContext, type AuthContextValue } from "./auth-provider";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user, their role and permissions in the active organization (`GET /users/me`). */
export function useCurrentUser() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => usersApi.me({ signal }),
    enabled: status === "authenticated",
    staleTime: 60_000,
  });
}

/** Active organization + the organizations the user belongs to (for the switcher). */
export function useOrganization() {
  const { status, session, switchOrganization } = useAuth();
  const enabled = status === "authenticated";
  const current = useQuery({
    queryKey: qk.organization.current,
    queryFn: ({ signal }) => organizationsApi.current({ signal }),
    enabled,
    staleTime: 60_000,
  });
  const memberships = useQuery({
    queryKey: qk.myOrganizations,
    queryFn: ({ signal }) => usersApi.organizations({ signal }),
    enabled,
    staleTime: 60_000,
  });
  return {
    organization: current.data,
    organizations: memberships.data ?? [],
    tenantId: session?.tenantId ?? null,
    isLoading: current.isLoading,
    error: current.error ?? memberships.error,
    switchOrganization,
  };
}

/**
 * Permission-aware UI. This is UX only — the backend authorizes every request and the UI must
 * handle 403 anyway (see ErrorState / PermissionDenied).
 */
export function usePermissions() {
  const me = useCurrentUser();
  const granted = useMemo(() => new Set<string>(me.data?.permissions ?? []), [me.data?.permissions]);
  const can = useCallback((permission: PermissionCode) => granted.has(permission), [granted]);
  const canAny = useCallback((...permissions: PermissionCode[]) => permissions.some((p) => granted.has(p)), [granted]);
  return {
    can,
    canAny,
    isPlatformAdmin: Boolean(me.data?.is_platform_admin),
    role: me.data?.role ?? null,
    isLoading: me.isLoading,
  };
}
