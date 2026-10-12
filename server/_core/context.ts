import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.ts";
import { getUserByAuthUserId, getUserByUsername, upsertUser } from "../db.ts";
import { ENV } from "./env.ts";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authFailureReason: string | null;
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

async function getSupabaseAuthUser(accessToken: string, supabaseKey: string): Promise<{ user: SupabaseAuthUser | null; status: number }> {
  const response = await fetch(`${ENV.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.warn("[Auth] Supabase /auth/v1/user returned", response.status);
    return { user: null, status: response.status };
  }

  const authUser = (await response.json()) as SupabaseAuthUser;
  return { user: authUser?.id ? authUser : null, status: response.status };
}

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;
  let authFailureReason: string | null = null;

  try {
    const token = getBearerToken(opts.req.get("authorization"));
    if (!token) {
      return { req: opts.req, res: opts.res, user: null, authFailureReason: "missing_authorization" };
    }

    // Prefer the server-configured publishable key. If Preview has no server
    // key or it is stale, retry with the app's public publishable key sent by
    // the browser. A key is never sufficient by itself: the bearer token is
    // still validated by Supabase and role privileges still come from our DB.
    const requestSupabaseKey = opts.req.get("x-supabase-apikey")?.trim() || "";
    const candidateKeys = Array.from(new Set([ENV.supabasePublishableKey, requestSupabaseKey].filter(Boolean)));

    if (!ENV.supabaseUrl || !candidateKeys.length) {
      console.warn("[Auth] Supabase server environment is not configured.");
      return { req: opts.req, res: opts.res, user: null, authFailureReason: "supabase_config_missing" };
    }

    let authUser: SupabaseAuthUser | null = null;
    let authHttpStatus: number | null = null;
    for (const key of candidateKeys) {
      const result = await getSupabaseAuthUser(token, key);
      authUser = result.user;
      authHttpStatus = result.status;
      if (authUser) break;
    }
    if (!authUser) {
      authFailureReason = authHttpStatus ? `supabase_token_rejected_http_${authHttpStatus}` : "supabase_auth_validation_failed";
      return { req: opts.req, res: opts.res, user: null, authFailureReason };
    }

    const username = usernameFromAuthUser(authUser);
    if (!username) {
      console.warn("[Auth] Supabase user has no username/email identity.");
      return { req: opts.req, res: opts.res, user: null, authFailureReason: "supabase_identity_missing" };
    }

    console.info("[Auth] Auth user validated:", {
      authUserId: authUser.id,
      username,
    });

    user = (await getUserByAuthUserId(authUser.id)) ?? null;

    if (!user) {
      const existingProfile = await getUserByUsername(username);
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
      authFailureReason = "local_profile_not_found";
    }

    if (user) {
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
    authFailureReason = "auth_context_exception";
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authFailureReason: user ? null : authFailureReason ?? "auth_user_unavailable",
  };
}
