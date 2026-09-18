import { supabase } from "@/lib/supabase";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

type AppUser = {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  roomId: number | null;
  authUserId?: string;
};

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

function buildAppUser(authUser: SupabaseUser): AppUser {
  const metadata = authUser.user_metadata ?? {};
  const usernameFromMetadata =
    typeof metadata.username === "string" ? metadata.username.trim().toLowerCase() : "";
  const email = authUser.email?.trim().toLowerCase() ?? "";
  const username =
    usernameFromMetadata ||
    (email.includes("@") ? email.split("@")[0] : email) ||
    "user";

  const metadataRole = metadata.role;
  const role: "user" | "admin" =
    metadataRole === "admin" || username === "admin" ? "admin" : "user";

  const metadataId = Number(metadata.app_user_id ?? metadata.user_id ?? 0);

  return {
    id: Number.isFinite(metadataId) && metadataId > 0 ? metadataId : 0,
    username,
    name:
      typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : username,
    email: authUser.email ?? null,
    role,
    roomId:
      Number.isFinite(Number(metadata.roomId)) && Number(metadata.roomId) > 0
        ? Number(metadata.roomId)
        : null,
    authUserId: authUser.id,
  };
}

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ? buildAppUser(data.session.user) : null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ? buildAppUser(nextSession.user) : null);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (!authReady || session) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    if (redirectPath) {
      window.location.href = redirectPath;
    }
  }, [redirectOnUnauthenticated, redirectPath, authReady, session]);

  return {
    user,
    loading: !authReady,
    error: null,
    isAuthenticated: Boolean(session),
    session,
    refresh: async () => undefined,
    logout,
  };
}
