"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { authApi } from "@/lib/api/auth";
import { normalizeError } from "@/lib/api/errors";
import {
  adoptBodyRefreshToken,
  refreshSession,
  sessionFromTokenResponse,
  sessionStore,
  type Session,
} from "@/lib/api/session";
import type { RegisterRequest } from "@/lib/api/schemas";
import { track } from "@/lib/analytics";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unreachable";

export interface LoginInput {
  email: string;
  password: string;
  mfaCode?: string;
  deviceName?: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  startGoogleLogin: (next?: string) => Promise<void>;
  completeGoogleLogin: (code: string, state: string) => Promise<string>;
  /** Retry bootstrapping after the API was unreachable. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const POST_LOGIN_KEY = "agentos:post-login-redirect";

/** Only same-app relative paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tenantRef = useRef<string | null>(null);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Bootstrap: exchange the refresh cookie (if any) for an in-memory access token.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then(() => {
        if (!cancelled) setBootstrapped(true);
      })
      .catch(() => {
        if (!cancelled) {
          setUnreachable(true);
          setBootstrapped(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Organization changed (here or in another tab): never show another tenant's cached data.
  useEffect(() => {
    const tenant = session?.tenantId ?? null;
    if (tenantRef.current !== null && tenant !== tenantRef.current) queryClient.clear();
    tenantRef.current = tenant;
  }, [session?.tenantId, queryClient]);

  // Session could not be refreshed (expired/revoked/signed out elsewhere): back to sign-in.
  useEffect(
    () =>
      sessionStore.onExpired((reason) => {
        queryClient.clear();
        const current = pathRef.current ?? "/app";
        if (current.startsWith("/app")) {
          router.replace(`/login?next=${encodeURIComponent(current)}&reason=${encodeURIComponent(reason)}`);
        }
      }),
    [queryClient, router],
  );

  const login = useCallback(
    async ({ email, password, mfaCode, deviceName }: LoginInput) => {
      const token = await authApi.login({
        email,
        password,
        mfa_code: mfaCode || null,
        device_name: deviceName ?? browserDeviceName(),
      });
      queryClient.clear();
      sessionStore.set(sessionFromTokenResponse(token));
      setUnreachable(false);
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      const token = await authApi.register(input);
      // Registration returns the refresh token in the body; trade it once for cookie delivery so it
      // never needs to be stored by JavaScript.
      if (token.refresh_token) {
        await adoptBodyRefreshToken(token.refresh_token);
      } else {
        sessionStore.set(sessionFromTokenResponse(token));
      }
      queryClient.clear();
      track("user_registered");
    },
    [queryClient],
  );

  const signOutLocally = useCallback(() => {
    sessionStore.clear({ broadcast: true, forgetCookie: true });
    queryClient.clear();
    router.replace("/login");
  }, [queryClient, router]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Server-side revocation failed (e.g. offline); local sign-out still proceeds.
    }
    signOutLocally();
  }, [signOutLocally]);

  const logoutAll = useCallback(async () => {
    await authApi.logoutAll();
    try {
      await authApi.logout();
    } catch {
      /* the current session is already revoked by logout-all */
    }
    signOutLocally();
  }, [signOutLocally]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const token = await authApi.switchOrganization(organizationId);
      queryClient.clear();
      sessionStore.set(sessionFromTokenResponse(token));
      router.push("/app");
    },
    [queryClient, router],
  );

  const startGoogleLogin = useCallback(async (next?: string) => {
    const { authorization_url } = await authApi.googleStart();
    try {
      sessionStorage.setItem(POST_LOGIN_KEY, safeNextPath(next));
    } catch {
      /* storage unavailable: fall back to /app after sign-in */
    }
    window.location.assign(authorization_url);
  }, []);

  const completeGoogleLogin = useCallback(
    async (code: string, state: string) => {
      const token = await authApi.googleCallback(code, state);
      queryClient.clear();
      sessionStore.set(sessionFromTokenResponse(token));
      let next = "/app";
      try {
        next = safeNextPath(sessionStorage.getItem(POST_LOGIN_KEY));
        sessionStorage.removeItem(POST_LOGIN_KEY);
      } catch {
        /* ignore */
      }
      return next;
    },
    [queryClient],
  );

  const status: AuthStatus = !bootstrapped
    ? "loading"
    : session
      ? "authenticated"
      : unreachable
        ? "unreachable"
        : "unauthenticated";

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      login,
      register,
      logout,
      logoutAll,
      switchOrganization,
      startGoogleLogin,
      completeGoogleLogin,
      retry: () => {
        setUnreachable(false);
        setBootstrapped(false);
        setAttempt((n) => n + 1);
      },
    }),
    [status, session, login, register, logout, logoutAll, switchOrganization, startGoogleLogin, completeGoogleLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function browserDeviceName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

export { normalizeError };
