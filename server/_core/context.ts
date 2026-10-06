import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.ts";
import { getUserByAuthUserId, getUserByUsername, upsertUser } from "../db.ts";
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

function usernameFromAuthUser(user: SupabaseAuthUser) {
  const metadataUsername = user.user_metadata?.username;
  if (typeof metadataUsername === "string" && metadataUsername.trim()) {
    return metadataUsername.trim().toLowerCase();
  }

  const email = user.email?.trim().toLowerCase() ?? "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : "";
}

async function getSupabaseAuthUser(
  accessToken: string,
  supabaseKey: string,
): Promise<SupabaseAuthUser | null> {
  const response = await fetch(`${ENV.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  console.info("[AuthDiag] Supabase validation", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    try {
      const body = (await response.json()) as {
        code?: unknown;
        error?: unknown;
        error_code?: unknown;
        msg?: unknown;
        message?: unknown;
      };

      errorCode =
        typeof body.code === "string"
          ? body.code
          : typeof body.error_code === "string"
            ? body.error_code
            : typeof body.error === "string"
              ? body.error
              : null;

      errorMessage =
        typeof body.msg === "string"
          ? body.msg
          : typeof body.message === "string"
            ? body.message
            : null;
    } catch {
      // Keep diagnostics safe even when Supabase does not return JSON.
    }

    console.warn("[AuthDiag] Supabase rejection", {
      status: response.status,
      errorCode,
      errorMessage,
    });

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
  let authStage = "start";

  try {
    authStage = "request";
    const authorizationHeader = opts.req.get("authorization");
    const token = getBearerToken(authorizationHeader);

    const requestSupabaseKey = opts.req.get("x-supabase-apikey")?.trim() || "";
    const supabaseKey = ENV.supabasePublishableKey || requestSupabaseKey;
    const supabaseKeySource = ENV.supabasePublishableKey
      ? "server-env-or-vite-fallback"
      : requestSupabaseKey
        ? "request-header-compatibility"
        : "none";

    console.info("[AuthDiag] request", {
      hasAuthorizationHeader: Boolean(authorizationHeader),
      hasBearerToken: Boolean(token),
      hasSupabaseUrl: Boolean(ENV.supabaseUrl),
      hasSupabaseKey: Boolean(supabaseKey),
      supabaseKeySource,
      keyLooksLikePublishable: supabaseKey.startsWith("sb_publishable_"),
      keyLength: supabaseKey.length,
    });

    if (!token) {
      return { req: opts.req, res: opts.res, user: null };
    }

    // The API key used to validate a user JWT is server configuration.
    // Prefer the server-side value so a stale/mismatched browser build cannot
    // make production authentication depend on an old client key.
    if (!ENV.supabaseUrl || !supabaseKey) {
      console.warn("[Auth] Supabase server environment is not configured.");
      return { req: opts.req, res: opts.res, user: null };
    }

    authStage = "supabase-user";
    const authUser = await getSupabaseAuthUser(token, supabaseKey);

    console.info("[AuthDiag] auth user", {
      found: Boolean(authUser),
    });

    if (!authUser) {
      return { req: opts.req, res: opts.res, user: null };
    }

    const username = usernameFromAuthUser(authUser);
    if (!username) {
      console.warn("[Auth] Supabase user has no username/email identity.");
      return { req: opts.req, res: opts.res, user: null };
    }

    console.info("[Auth] Auth user validated:", {
      authUserId: authUser.id,
      username,
    });

    authStage = "local-user";
    user = (await getUserByAuthUserId(authUser.id)) ?? null;

    console.info("[AuthDiag] local profile", {
      foundByAuthUserId: Boolean(user),
    });

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
    }

    if (user) {
      authStage = "upsert-user";
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

      console.info("[AuthDiag] context user", {
        found: Boolean(user),
      });
    }
  } catch (error) {
    console.warn("[AuthDiag] authentication failed", {
      stage: authStage,
      error: error instanceof Error ? error.message : String(error),
    });
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
