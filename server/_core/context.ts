import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.ts";
import { getUserByAuthUserId, getUserByUsername, getUserByUsernameForAuthFallback, upsertUser } from "../db.ts";
import { ENV } from "./env.ts";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authError?: string | null;
};

function getBearerToken(authorization: string | undefined) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function usernameFromAuthUser(user: SupabaseAuthUser) {
  const metadataUsername = user.user_metadata?.username;
  if (typeof metadataUsername === "string" && metadataUsername.trim()) {
    return metadataUsername.trim().toLowerCase();
  }

  const email = user.email?.trim().toLowerCase() ?? "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : "";
}

async function getSupabaseAuthUser(accessToken: string, supabaseKey: string, supabaseUrl: string): Promise<SupabaseAuthUser | null> {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.warn("[Auth] Supabase /auth/v1/user returned", response.status);
    return null;
  }

  const authUser = (await response.json()) as SupabaseAuthUser;
  return authUser?.id ? authUser : null;
}

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const token = getBearerToken(opts.req.get("authorization"));
    if (!token) {
      return { req: opts.req, res: opts.res, user: null, authError: "Session token tidak dikirim oleh browser." };
    }

    const requestSupabaseUrl = opts.req.get("x-supabase-url")?.trim() || "";
    const requestSupabaseKey = opts.req.get("x-supabase-apikey")?.trim() || "";
    // Browser auth and the tRPC API must validate against the same Supabase
    // project. The URL/key sent by the browser are public Supabase config
    // values, so prefer them when present; server env remains the fallback.
    const supabaseUrl = requestSupabaseUrl || ENV.supabaseUrl;
    const supabaseKey = requestSupabaseKey || ENV.supabasePublishableKey;

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[Auth] Supabase server environment is not configured.", {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseKey: Boolean(supabaseKey),
      });
      return { req: opts.req, res: opts.res, user: null, authError: "Konfigurasi Supabase server belum tersedia." };
    }

    const authUser = await getSupabaseAuthUser(token, supabaseKey, supabaseUrl);
    if (!authUser) {
      return { req: opts.req, res: opts.res, user: null, authError: "Session Supabase ditolak saat divalidasi oleh backend." };
    }

    const username = usernameFromAuthUser(authUser);
    if (!username) {
      console.warn("[Auth] Supabase user has no username/email identity.");
      return { req: opts.req, res: opts.res, user: null, authError: "Identitas username/email dari session Supabase tidak ditemukan." };
    }

    console.info("[Auth] Auth user validated:", {
      authUserId: authUser.id,
      username,
    });

    let usedAuthUserLookup = true;

    try {
      user = (await getUserByAuthUserId(authUser.id)) ?? null;
    } catch (error) {
      // A Preview database may still have the pre-auth linkage users schema.
      // The Supabase token is already validated, so fall back to the stable
      // username identity without attempting to write auth_user_id there.
      usedAuthUserLookup = false;
      console.warn("[Auth] auth_user_id lookup failed; using username fallback:", error);
      user = (await getUserByUsernameForAuthFallback(username)) ?? null;
    }

    if (!user) {
      const existingProfile = await getUserByUsernameForAuthFallback(username);
      if (existingProfile) {
        user = (await upsertUser({
          id: existingProfile.id,
          username,
          name: existingProfile.name ?? (typeof authUser.user_metadata?.name === "string" ? authUser.user_metadata.name : username),
          email: authUser.email ?? existingProfile.email ?? null,
          authUserId: authUser.id,
          role: existingProfile.role,
          roomId: existingProfile.roomId,
          lastSignedIn: new Date(),
        })) ?? null;
      }
    }

    if (!user) {
      console.warn("[Auth] No local user profile found for:", {
        authUserId: authUser.id,
        username,
      });
      return { req: opts.req, res: opts.res, user: null, authError: "Session Supabase valid, tetapi profil user lokal tidak ditemukan." };
    }

    if (user && usedAuthUserLookup) {
      user = await upsertUser({
        id: user.id,
        username: user.username,
        name: user.name,
        email: authUser.email ?? user.email ?? null,
        authUserId: authUser.id,
        role: user.role,
        roomId: user.roomId,
        lastSignedIn: new Date(),
      }) ?? user;
    }
  } catch (error) {
    console.warn("[Auth] Supabase authentication failed:", error);
    user = null;
    return {
      req: opts.req,
      res: opts.res,
      user: null,
      authError: error instanceof Error ? `Autentikasi backend gagal: ${error.message}` : "Autentikasi backend gagal.",
    };
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authError: null,
  };
}
