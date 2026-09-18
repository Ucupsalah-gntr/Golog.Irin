import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserByAuthUserId, getUserByUsername, upsertUser } from "../db";
import { supabaseServer } from "./supabase";

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

function usernameFromAuthUser(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const metadataUsername = user.user_metadata?.username;
  if (typeof metadataUsername === "string" && metadataUsername.trim()) {
    return metadataUsername.trim().toLowerCase();
  }

  const email = user.email?.trim().toLowerCase() ?? "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : "";
}

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const token = getBearerToken(opts.req.headers.authorization);
    if (!token) {
      return { req: opts.req, res: opts.res, user: null };
    }

    const { data, error } = await supabaseServer.auth.getUser(token);
    if (error || !data.user) {
      return { req: opts.req, res: opts.res, user: null };
    }

    const authUser = data.user;
    const username = usernameFromAuthUser(authUser);
    if (!username) {
      return { req: opts.req, res: opts.res, user: null };
    }

    user = await getUserByAuthUserId(authUser.id);

    if (!user) {
      const existingProfile = await getUserByUsername(username);
      if (existingProfile) {
        user = (await upsertUser({
          id: existingProfile.id,
          username,
          name: existingProfile.name ?? authUser.user_metadata?.name ?? username,
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
