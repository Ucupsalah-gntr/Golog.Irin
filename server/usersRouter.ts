import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.ts";
import { getDb, rooms, userRoomAccess, users, writeAudit } from "./db.ts";

export const usersRouter = router({
  myRooms: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select({ room: rooms }).from(userRoomAccess).innerJoin(rooms, eq(userRoomAccess.roomId, rooms.id)).where(and(eq(userRoomAccess.userId, ctx.user.id), eq(userRoomAccess.active, true), eq(rooms.active, true))).orderBy(rooms.name);
  }),

  assignRooms: adminProcedure.input(z.object({ userId: z.number().int().positive(), roomIds: z.array(z.number().int().positive()).max(50) })).mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
    const targetRows = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    const target = targetRows[0];
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Akun tidak ditemukan." });
    const uniqueRoomIds = Array.from(new Set(input.roomIds));
    const roomRows = uniqueRoomIds.length ? await db.select().from(rooms).where(eq(rooms.active, true)) : [];
    const activeRoomIds = new Set(roomRows.map((room) => room.id));
    if (uniqueRoomIds.some((roomId) => !activeRoomIds.has(roomId))) throw new TRPCError({ code: "BAD_REQUEST", message: "Ada ruangan yang tidak ditemukan atau tidak aktif." });
    await db.transaction(async (tx) => {
      await tx.update(userRoomAccess).set({ active: false, updatedAt: new Date() }).where(eq(userRoomAccess.userId, input.userId));
      for (const roomId of uniqueRoomIds) {
        await tx.insert(userRoomAccess).values({ userId: input.userId, roomId, active: true, updatedAt: new Date() }).onConflictDoUpdate({ target: [userRoomAccess.userId, userRoomAccess.roomId], set: { active: true, updatedAt: new Date() } });
      }
      await tx.update(users).set({ roomId: uniqueRoomIds[0] ?? null, updatedAt: new Date() }).where(eq(users.id, input.userId));
    });
    await writeAudit(ctx.user.id, "assign_rooms", "user", target.id, { roomIds: target.roomId === null ? [] : [target.roomId] }, { roomIds: uniqueRoomIds }, "Akses ruangan akun diperbarui");
    return { success: true, userId: target.id, roomIds: uniqueRoomIds } as const;
  }),


  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        roomId: users.roomId,
        room: rooms,
        roomIds: sql<number[]>`COALESCE(ARRAY_AGG(${userRoomAccess.roomId}) FILTER (WHERE ${userRoomAccess.active} = true), ARRAY[]::integer[])`,
      })
      .from(users)
      .leftJoin(rooms, eq(users.roomId, rooms.id))
      .leftJoin(userRoomAccess, eq(userRoomAccess.userId, users.id))
      .groupBy(users.id, rooms.id)
      .orderBy(users.name, users.email);
  }),
});
