import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserByAuthUserId, getUserByUsername, upsertUser } from "../db";
import { ENV } from "./env";

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

async function getSupabaseAuthUser(accessToken: string): Promise<SupabaseAuthUser | null> {
  const response = await fetch(`${ENV.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: ENV.supabasePublishableKey,
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

    if (!ENV.supabaseUrl || !ENV.supabasePublishableKey) {
      console.warn("[Auth] Supabase server environment is not configured.");
      return { req: opts.req, res: opts.res, user: null };
    }

    const authUser = await getSupabaseAuthUser(token);
    if (!authUser) {
      return { req: opts.req, res: opts.res, user: null };
    }

    const username = usernameFromAuthUser(authUser);
    if (!username) {
      return { req: opts.req, res: opts.res, user: null };
    }

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
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
