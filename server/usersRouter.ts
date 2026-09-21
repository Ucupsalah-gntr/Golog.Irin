import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc.ts";
import { getDb, rooms, users, writeAudit } from "./db.ts";

export const usersRouter = router({
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
