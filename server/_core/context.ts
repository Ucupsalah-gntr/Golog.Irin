import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.ts";
import { getUserByAuthUserId, updateUserLastSignedInByAuthUserId } from "../db.ts";
import { ENV } from "./env.ts";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
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

async function getSupabaseAuthUser(accessToken: string, supabaseKey: string): Promise<SupabaseAuthUser | null> {
  const response = await fetch(`${ENV.supabaseUrl}/auth/v1/user`, {
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
      return { req: opts.req, res: opts.res, user: null };
    }

    // The API key used to validate a user JWT is server configuration.
    // Prefer the server-side value so a stale/mismatched browser build cannot
    // make production authentication depend on an old client key.
    const requestSupabaseKey = opts.req.get("x-supabase-apikey")?.trim() || "";
    const supabaseKey = ENV.supabasePublishableKey || requestSupabaseKey;

    if (!ENV.supabaseUrl || !supabaseKey) {
      console.warn("[Auth] Supabase server environment is not configured.");
      return { req: opts.req, res: opts.res, user: null };
    }

    const authUser = await getSupabaseAuthUser(token, supabaseKey);
    if (!authUser) {
      return { req: opts.req, res: opts.res, user: null };
    }

    // A Supabase identity must be provisioned against an application profile
    // before it can enter the app. Never link by username/email: user metadata
    // can be changed by the client and must not be able to claim an admin profile.
    user = (await getUserByAuthUserId(authUser.id)) ?? null;

    if (!user) {
      console.warn("[Auth] Supabase identity has no pre-linked application profile:", {
        authUserId: authUser.id,
      });
    } else {
      // Only update the sign-in timestamp by immutable auth id. Do not call a
      // general-purpose upsert here because it also has username-based lookup
      // behavior intended for provisioning, not for authenticating a session.
      user = await updateUserLastSignedInByAuthUserId(authUser.id) ?? user;
    }
  } catch (error) {
    console.warn("[Auth] Supabase authentication failed:", error);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
