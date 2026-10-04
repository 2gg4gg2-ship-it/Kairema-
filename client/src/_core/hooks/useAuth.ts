import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { clearDirectKeys } from "@/lib/direct-key-store";
import { reportAuthMe, nextDiagId } from "@/lib/diag";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        // The session is already gone server-side. Clearing below still has to run, or a key that
        // only ever lived in this tab would outlive the account that entered it.
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      // A browser-direct key belongs to the account that typed it. Leaving it in the tab across a
      // logout would hand the next person to use this browser the previous user's credential, and
      // it would still be attached to that user's provider requests.
      clearDirectKeys();
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Navigate at this moment only. startLogin() mints the nonce + cookie itself.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  // Diagnostic timing for the one request that gates the welcome screen. Observes the query and
  // nothing else: retry, refetch and cache settings above are untouched, and no part of the session,
  // the error or the response is recorded beyond a status code.
  const authMeStartedAtMs = useRef<number | null>(null);
  const authMeDiagId = useRef<string | null>(null);
  useEffect(() => {
    if (meQuery.isLoading) {
      if (authMeStartedAtMs.current === null) {
        authMeStartedAtMs.current = Date.now();
        authMeDiagId.current = nextDiagId();
      }
      return;
    }
    const startedAtMs = authMeStartedAtMs.current;
    if (startedAtMs === null) return;
    authMeStartedAtMs.current = null;
    const failed = meQuery.isError;
    const status =
      failed && meQuery.error instanceof TRPCClientError
        ? (meQuery.error.data as { httpStatus?: number } | undefined)?.httpStatus
        : undefined;
    reportAuthMe(
      authMeDiagId.current ?? nextDiagId(),
      failed ? "error" : "ok",
      status,
      Date.now() - startedAtMs,
    );
    authMeDiagId.current = null;
  }, [meQuery.isLoading, meQuery.isError, meQuery.dataUpdatedAt, meQuery.error]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
