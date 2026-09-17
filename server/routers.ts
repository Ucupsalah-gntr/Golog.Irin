import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { canTransitionRequestStatus, validateApprovedQuantity } from "@shared/request-rules";
import { canReuseRequestDayLock, getJakartaDateKey } from "@shared/request-day-lock";
import {
  ensureCatalog,
  getDashboardData,
  getDb,
  getReportMovements,
  getStockQty,
  writeAudit,
  items,
  requestDayLocks,
  requestItems,
  requests,
  rooms,
  stockAdjustments,
  stockMovements,
  users,
  warehouses,
} from "./db";

const roleGuard = (role: "admin" | "user") => protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== role && !(role === "user" && ctx.user.role === "admin")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Anda tidak memiliki akses ke aksi ini." });
  }
  return next();
});
const operatorProcedure = roleGuard("user");

function nowNo(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString().slice(-5)}`;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  catalog: router({
    all: protectedProcedure.query(async () => {
      await ensureCatalog();
      const db = await getDb();
      if (!db) return { rooms: [], warehouses: [], items: [] };
      return {
        rooms: await db.select().from(rooms).where(eq(rooms.active, true)).orderBy(rooms.name),
        warehouses: await db.select().from(warehouses).where(eq(warehouses.active, true)).orderBy(warehouses.name),
        items: await db.select().from(items).where(eq(items.active, true)).orderBy(items.name),
      };
    }),
    createItem: adminProcedure.input(z.object({ sku: z.string().min(1), name: z.string().min(2), unit: z.string().min(1), category: z.string().optional(), sourceWarehouseId: z.number().nullable().optional(), minStock: z.number().int().min(0).default(0) })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const result = await db.insert(items).values(input);
      await writeAudit(ctx.user.id, "create", "item", Number(result[0].insertId), null, input, "Master barang dibuat");
      return { id: Number(result[0].insertId) };
    }),
  }),
  dashboard: router({
    summary: protectedProcedure.query(async () => getDashboardData()),
  }),
  inbound: router({
    create: adminProcedure.input(z.object({ itemId: z.number().int(), quantity: z.number().int().positive(), sourceWarehouseId: z.number().int(), occurredAt: z.coerce.date().optional(), notes: z.string().max(500).optional() })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const result = await db.insert(stockMovements).values({ ...input, movementType: "in", createdBy: ctx.user.id, occurredAt: input.occurredAt ?? new Date() });
      await writeAudit(ctx.user.id, "create", "stock_movement", Number(result[0].insertId), null, input, "Barang masuk dicatat");
      return { id: Number(result[0].insertId) };
    }),
  }),
  requests: router({
    todayLocks: protectedProcedure.query(async () => {
      const db = await getDb(); if (!db) return [];
      const requestDate = getJakartaDateKey();
      return db
        .select({
          roomId: requestDayLocks.roomId,
          requestDate: requestDayLocks.requestDate,
          requesterId: requestDayLocks.requesterId,
          requesterName: users.name,
        })
        .from(requestDayLocks)
        .leftJoin(rooms, eq(requestDayLocks.roomId, rooms.id))
        .leftJoin(users, eq(requestDayLocks.requesterId, users.id))
        .where(and(eq(requestDayLocks.requestDate, requestDate), eq(rooms.active, true)))
        .orderBy(requestDayLocks.roomId);
    }),
    list: protectedProcedure.input(z.object({ status: z.string().optional(), roomId: z.number().optional() }).optional()).query(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) return [];
      const filters = [];
      if (input?.status) filters.push(eq(requests.status, input.status as any));

      // Petugas tetap melihat riwayat request yang dibuat oleh akunnya sendiri.
      // Tidak ada lagi pembatasan request berdasarkan users.roomId karena petugas
      // dapat berganti ruangan secara dinamis setiap hari.
      if (ctx.user.role !== "admin") {
        filters.push(eq(requests.createdBy, ctx.user.id));
      } else if (input?.roomId) {
        filters.push(eq(requests.roomId, input.roomId));
      }

      const rows = await db.select({ request: requests, room: rooms }).from(requests).leftJoin(rooms, eq(requests.roomId, rooms.id)).where(filters.length ? and(...filters) : undefined).orderBy(desc(requests.createdAt)).limit(100);
      const result = [];
      for (const row of rows) {
        const lines = await db.select({ line: requestItems, item: items }).from(requestItems).leftJoin(items, eq(requestItems.itemId, items.id)).where(eq(requestItems.requestId, row.request.id));
        result.push({ ...row, lines });
      }
      return result;
    }),
    create: operatorProcedure.input(z.object({ roomId: z.number().int().positive(), priority: z.enum(["normal", "mendesak", "darurat"]), notes: z.string().max(1000).optional(), lines: z.array(z.object({ itemId: z.number().int(), requestedQty: z.number().int().positive() })).min(1) })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });

      const requestDate = getJakartaDateKey();
      const now = new Date();
      const roomId = input.roomId;
      const requestAuditInput = { ...input, roomId, requestDate };

      const result = await db.transaction(async (tx) => {
        // Klaim ruangan untuk tanggal berjalan secara atomik. Unique key
        // (roomId, requestDate) menjamin hanya satu requester pertama yang
        // menjadi PIC request ruangan pada hari tersebut.
        await tx.insert(requestDayLocks)
          .values({ roomId, requestDate, requesterId: ctx.user.id })
          .onDuplicateKeyUpdate({ set: { requestDate } });

        const lockRows = await tx
          .select()
          .from(requestDayLocks)
          .where(and(eq(requestDayLocks.roomId, roomId), eq(requestDayLocks.requestDate, requestDate)))
          .limit(1);
        const lock = lockRows[0];

        if (!lock) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PIC request ruangan tidak dapat ditentukan." });
        }

        if (!canReuseRequestDayLock(lock.requesterId, ctx.user.id)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Ruangan ini sudah memiliki petugas request hari ini. Petugas tersebut yang dapat membuat request susulan.",
          });
        }

        const requestNo = nowNo("REQ");
        const inserted = await tx.insert(requests).values({
          requestNo,
          roomId,
          createdBy: ctx.user.id,
          priority: input.priority,
          notes: input.notes,
          status: "submitted",
          submittedAt: now,
        });
        const requestId = Number(inserted[0].insertId);

        await tx.insert(requestItems).values(
          input.lines.map((line) => ({ requestId, itemId: line.itemId, requestedQty: line.requestedQty }))
        );

        return { requestId, requestNo };
      });

      await writeAudit(
        ctx.user.id,
        "create",
        "request",
        result.requestId,
        null,
        requestAuditInput,
        `Permintaan ${result.requestNo} diajukan`
      );

      return result;
    }),
    verify: adminProcedure.input(z.object({ requestId: z.number().int(), status: z.enum(["approved", "partial", "rejected", "ready"]), lines: z.array(z.object({ lineId: z.number().int(), approvedQty: z.number().int().min(0) })).optional() })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const existing = await db.select().from(requests).where(eq(requests.id, input.requestId)).limit(1); const request = existing[0];
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Permintaan tidak ditemukan." });

      if (!canTransitionRequestStatus(request.status, input.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Status ${request.status} tidak dapat diubah menjadi ${input.status}.` });
      }

      const currentLines = await db.select().from(requestItems).where(eq(requestItems.requestId, input.requestId));

      if (input.status === "rejected") {
        if (input.lines?.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permintaan yang ditolak tidak perlu mengubah jumlah item." });
        }
      } else {
        if (!currentLines.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permintaan tidak memiliki item yang dapat diverifikasi." });
        }
        if (!input.lines || input.lines.length !== currentLines.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Semua item pada permintaan harus diverifikasi." });
        }

        const linesById = new Map(currentLines.map((line) => [line.id, line]));
        const seenLineIds = new Set<number>();
        let totalApproved = 0;

        for (const line of input.lines) {
          if (seenLineIds.has(line.lineId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Item verifikasi duplikat." });
          }
          seenLineIds.add(line.lineId);

          const currentLine = linesById.get(line.lineId);
          if (!currentLine) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Item verifikasi tidak termasuk dalam permintaan ini." });
          }

          try {
            validateApprovedQuantity(currentLine.requestedQty, line.approvedQty);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Jumlah disetujui untuk item ${currentLine.itemId} tidak boleh melebihi jumlah yang diminta.` });
          }

          totalApproved += line.approvedQty;
          await db.update(requestItems)
            .set({ approvedQty: line.approvedQty })
            .where(and(eq(requestItems.id, line.lineId), eq(requestItems.requestId, input.requestId)));
        }

        if (totalApproved <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Jumlah disetujui harus lebih dari 0." });
        }
      }

      await db.update(requests).set({ status: input.status, verifiedAt: new Date() }).where(eq(requests.id, input.requestId));
      await writeAudit(ctx.user.id, "verify", "request", input.requestId, request, { status: input.status, lines: input.lines }, "Permintaan diverifikasi kepala gudang");
      return { success: true };
    }),
    deliver: adminProcedure.input(z.object({ requestId: z.number().int() })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });

      const result = await db.transaction(async (tx) => {
        const existing = await tx.select().from(requests).where(eq(requests.id, input.requestId)).limit(1).for("update");
        const request = existing[0];

        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Permintaan tidak ditemukan." });
        }

        if (["delivered", "received"].includes(request.status)) {
          throw new TRPCError({ code: "CONFLICT", message: `Permintaan ${request.requestNo} sudah pernah diserahkan.` });
        }

        if (!["approved", "partial", "ready"].includes(request.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permintaan belum berada pada tahap yang dapat diserahkan." });
        }

        const lines = await tx.select().from(requestItems).where(eq(requestItems.requestId, input.requestId));
        const now = new Date();

        for (const line of lines) {
          if (!line.approvedQty) continue;
          if (line.deliveredQty > 0) {
            throw new TRPCError({ code: "CONFLICT", message: `Item pada permintaan ${request.requestNo} sudah pernah diserahkan.` });
          }

          const stockRows = await tx
            .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)` })
            .from(stockMovements)
            .where(eq(stockMovements.itemId, line.itemId));
          const available = Number(stockRows[0]?.qty ?? 0);

          if (available < line.approvedQty) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Stok tidak cukup untuk salah satu item." });
          }

          await tx.insert(stockMovements).values({
            itemId: line.itemId,
            movementType: "out",
            quantity: -line.approvedQty,
            roomId: request.roomId,
            requestId: request.id,
            createdBy: ctx.user.id,
            notes: `Distribusi ${request.requestNo}`,
          });

          await tx.update(requestItems)
            .set({ deliveredQty: line.approvedQty })
            .where(eq(requestItems.id, line.id));
        }

        await tx.update(requests)
          .set({ status: "delivered", deliveredAt: now })
          .where(eq(requests.id, input.requestId));

        return { request, deliveredAt: now };
      });

      await writeAudit(
        ctx.user.id,
        "deliver",
        "request",
        input.requestId,
        result.request,
        { status: "delivered", deliveredAt: result.deliveredAt },
        "Barang diserahkan ke ruangan"
      );

      return { success: true };
    }),
    receive: protectedProcedure.input(z.object({ requestId: z.number().int() })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });

      const existing = await db.select().from(requests).where(eq(requests.id, input.requestId)).limit(1);
      const request = existing[0];

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Permintaan tidak ditemukan." });
      }

      if (ctx.user.role !== "admin" && request.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Anda hanya dapat menerima permintaan yang Anda ajukan sendiri." });
      }

      if (request.status !== "delivered") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Barang belum berstatus diserahkan." });
      }

      const result = await db.update(requests)
        .set({ status: "received", receivedAt: new Date() })
        .where(and(eq(requests.id, input.requestId), eq(requests.status, "delivered")));

      if (result[0].affectedRows !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Status permintaan berubah. Silakan muat ulang halaman." });
      }

      await writeAudit(ctx.user.id, "receive", "request", input.requestId, request, { status: "received" }, "Penerimaan barang dikonfirmasi");
      return { success: true };
    }),
  }),
  adjustments: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb(); if (!db) return [];
      return db.select({ adjustment: stockAdjustments, item: items, room: rooms }).from(stockAdjustments).leftJoin(items, eq(stockAdjustments.itemId, items.id)).leftJoin(rooms, eq(stockAdjustments.roomId, rooms.id)).orderBy(desc(stockAdjustments.createdAt)).limit(100);
    }),
    applyAdjustment: adminProcedure.input(z.object({ itemId: z.number().int(), roomId: z.number().int().nullable().optional(), adjustmentType: z.enum(["add", "subtract"]), quantity: z.number().int().positive(), physicalQty: z.number().int().min(0), reasonType: z.enum(["forgotten_entry", "holiday_pickup", "damaged", "expired", "emergency", "stocktake", "other"]), reason: z.string().min(10), incidentDate: z.coerce.date() })).mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const systemQty = await getStockQty(input.itemId);
      if (input.adjustmentType === "subtract" && input.quantity > systemQty) throw new TRPCError({ code: "BAD_REQUEST", message: "Penyesuaian pengurangan melebihi stok sistem." });
      const adjustmentNo = nowNo("ADJ");
      const inserted = await db.insert(stockAdjustments).values({ ...input, adjustmentNo, systemQty, status: "applied", createdBy: ctx.user.id, verifiedBy: ctx.user.id, appliedAt: new Date() });
      const adjustmentId = Number(inserted[0].insertId);
      const signedQty = input.adjustmentType === "add" ? input.quantity : -input.quantity;
      await db.insert(stockMovements).values({ itemId: input.itemId, movementType: "adjustment", quantity: signedQty, roomId: input.roomId, adjustmentId, createdBy: ctx.user.id, notes: input.reason, occurredAt: input.incidentDate });
      await writeAudit(ctx.user.id, "apply", "stock_adjustment", adjustmentId, { systemQty }, { ...input, adjustmentNo, status: "applied", verifiedBy: ctx.user.id }, "Self-verification kepala gudang");
      return { adjustmentId, adjustmentNo };
    }),
  }),
  reports: router({
    movements: protectedProcedure.input(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).optional()).query(({ input }) => getReportMovements(input?.from, input?.to)),
  }),
});

export type AppRouter = typeof appRouter;
