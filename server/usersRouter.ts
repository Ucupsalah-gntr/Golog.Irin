import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc.ts";
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
      })
      .from(users)
      .leftJoin(rooms, eq(users.roomId, rooms.id))
      .orderBy(users.name, users.email);
  }),

  assignRoom: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        roomId: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database belum tersedia.",
        });
      }

      const targetRows = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const target = targetRows[0];

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Akun tidak ditemukan.",
        });
      }

      let room = null;
      if (input.roomId !== null) {
        const roomRows = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .limit(1);
        room = roomRows[0] ?? null;

        if (!room || !room.active) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ruangan tidak ditemukan atau sedang tidak aktif.",
          });
        }
      }

      const result = await db
        .update(users)
        .set({ roomId: input.roomId })
        .where(eq(users.id, input.userId))
        .returning({ id: users.id });

      if (result.length !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Akun tidak berubah. Silakan muat ulang halaman.",
        });
      }

      await writeAudit(
        ctx.user.id,
        "assign_room",
        "user",
        target.id,
        { roomId: target.roomId },
        { roomId: input.roomId },
        room
          ? `Akun ${target.name ?? target.email ?? target.id} ditautkan ke ${room.name}`
          : `Akun ${target.name ?? target.email ?? target.id} dilepas dari ruangan`
      );

      return {
        success: true,
        userId: target.id,
        roomId: input.roomId,
      } as const;
    }),
});
