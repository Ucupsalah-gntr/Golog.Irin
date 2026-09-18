import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: authReady && Boolean(session),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        utils.auth.me.setData(undefined, undefined);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [utils]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
  }, [utils]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (!authReady || session || meQuery.isLoading) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    if (redirectPath) {
      window.location.href = redirectPath;
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    authReady,
    session,
    meQuery.isLoading,
  ]);

  return {
    user: meQuery.data ?? null,
    loading: !authReady || meQuery.isLoading,
    error: meQuery.error ?? null,
    isAuthenticated: Boolean(session && meQuery.data),
    session,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
