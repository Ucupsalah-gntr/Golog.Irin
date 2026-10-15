import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.ts";
import { getUserByAuthUserId, updateUserLastSignedInByAuthUserId } from "../db.ts";
import { ENV } from "./env.ts";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authFailureReason?: string | null;
};

function getBearerToken(authorization: string | undefined) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

type SupabaseAuthUser = { id: string };

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
  let authStage: "token" | "supabase" | "database" = "token";

  try {
    const token = getBearerToken(opts.req.get("authorization"));
    if (!token) {
      return { req: opts.req, res: opts.res, user: null, authFailureReason: "missing_authorization" };
    }

    authStage = "supabase";
    // Prefer the server key, but allow the browser's public key as a fallback
    // for Preview deployments. The bearer token is always validated by Supabase.
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
      authFailureReason = authHttpStatus
        ? `supabase_token_rejected_http_${authHttpStatus}`
        : "supabase_auth_validation_failed";
      return { req: opts.req, res: opts.res, user: null, authFailureReason };
    }

    if (!ENV.databaseUrl) {
      console.warn("[Auth] DATABASE_URL is not configured for this deployment.");
      return { req: opts.req, res: opts.res, user: null, authFailureReason: "database_config_missing" };
    }

    authStage = "database";
    // Only pre-linked immutable Supabase IDs may authenticate to a local profile.
    // Never claim a profile by username or mutable user metadata.
    user = (await getUserByAuthUserId(authUser.id)) ?? null;
    if (!user) {
      console.warn("[Auth] Supabase identity has no pre-linked application profile:", { authUserId: authUser.id });
      authFailureReason = "local_profile_not_found";
    } else {
      user = await updateUserLastSignedInByAuthUserId(authUser.id) ?? user;
    }
  } catch (error) {
    console.warn("[Auth] Authentication context failed at stage:", authStage, error);
    user = null;
    authFailureReason = authStage === "database" ? "database_lookup_failed" : "auth_context_exception";
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authFailureReason: user ? null : authFailureReason ?? "auth_user_unavailable",
  };
}
