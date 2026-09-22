import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  auditLogs,
  type InsertUser,
  type User,
  items,
  requestDayLocks,
  requestItems,
  requests,
  rooms,
  stockAdjustments,
  stockMovements,
  users,
  warehouses,
} from "../drizzle/schema.ts";
import { ENV } from "./_core/env.ts";
import { isLowStock } from "../shared/inventory.ts";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      _pool = new Pool({
        connectionString: ENV.databaseUrl,
        max: 1,
        ssl: { rejectUnauthorized: false },
      });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _pool = null;
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<User | undefined> {
  if (!user.authUserId) throw new Error("Supabase auth user id is required");
  if (!user.username) throw new Error("Username is required");

  const db = await getDb();
  if (!db) return undefined;

  const existingByAuth = await db
    .select()
    .from(users)
    .where(eq(users.authUserId, user.authUserId))
    .limit(1);

  const existingByUsername = existingByAuth[0]
    ? []
    : await db.select().from(users).where(eq(users.username, user.username)).limit(1);

  const existing = existingByAuth[0] ?? existingByUsername[0];

  if (existing) {
    const updateSet: Partial<InsertUser> = {
      username: user.username,
      name: user.name ?? existing.name,
      email: user.email ?? existing.email,
      authUserId: user.authUserId,
      lastSignedIn: user.lastSignedIn ?? new Date(),
      updatedAt: new Date(),
    };

    const updated = await db
      .update(users)
      .set(updateSet)
      .where(eq(users.id, existing.id))
      .returning();

    return updated[0] ?? existing;
  }

  const inserted = await db
    .insert(users)
    .values({
      ...user,
      lastSignedIn: user.lastSignedIn ?? new Date(),
    })
    .returning();

  return inserted[0];
}

export async function getUserByAuthUserId(authUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.authUserId, authUserId))
    .limit(1);
  return result[0];
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return result[0];
}

export async function ensureCatalog() {
  const db = await getDb();
  if (!db) return;
  const currentWarehouses = await db.select().from(warehouses);
  if (!currentWarehouses.length) {
    await db.insert(warehouses).values([
      { code: "FARMASI", name: "Gudang Farmasi", kind: "source" },
      { code: "GUDANG-RT", name: "Gudang RT", kind: "source" },
      { code: "CSSD", name: "CSSD", kind: "source" },
      { code: "LAB", name: "Laboratorium", kind: "source" },
      { code: "LOGISTIK-IR", name: "Gudang Logistik IR", kind: "logistics" },
    ]);
  }
  const currentRooms = await db.select().from(rooms);
  if (!currentRooms.length) {
    await db.insert(rooms).values([
      { code: "PICU", name: "PICU" },
      { code: "ICCU-ELANG", name: "ICCU Elang" },
      { code: "ICCU-CENTRAL", name: "ICCU Central" },
      { code: "ICU-RAJAWALI", name: "ICU Rajawali" },
      { code: "ICU-GARUDA", name: "ICU Garuda" },
      { code: "ICU-REGULER", name: "ICU Reguler" },
    ]);
  }
}

async function getStockRowsForRoom(roomId: number | null) {
  const db = await getDb();
  if (!db) return [];
  const locationFilter = roomId === null
    ? isNull(stockMovements.roomId)
    : eq(stockMovements.roomId, roomId);

  return db
    .select({
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      category: items.category,
      unit: items.unit,
      minStock: items.minStock,
      movementQty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)`,
    })
    .from(items)
    .leftJoin(stockMovements, and(
      eq(stockMovements.itemId, items.id),
      locationFilter,
    ))
    .where(eq(items.active, true))
    .groupBy(items.id, items.sku, items.name, items.category, items.unit, items.minStock)
    .orderBy(items.name);
}

export async function getStockRows() {
  return getStockRowsForRoom(null);
}

export async function getWarehouseStockRows() {
  return getStockRowsForRoom(null);
}

export async function getRoomStockRows(roomId: number) {
  return getStockRowsForRoom(roomId);
}

export async function getStockQty(itemId: number, roomId: number | null = null) {
  const db = await getDb();
  if (!db) return 0;

  const locationFilter = roomId === null
    ? isNull(stockMovements.roomId)
    : eq(stockMovements.roomId, roomId);

  const rows = await db
    .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)` })
    .from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), locationFilter));

  return Number(rows[0]?.qty ?? 0);
}

export async function getDashboardData(
  role: "admin" | "user",
  roomId: number | null = null,
  userId?: number,
) {
  const db = await getDb();
  if (!db) {
    return {
      scope: role === "admin" ? "warehouse" : "room",
      roomId,
      roomName: null,
      stats: { items: 0, lowStock: 0, pending: 0, todayIn: 0 },
      stock: [],
      recent: [],
    };
  }

  const stock = role === "admin"
    ? await getWarehouseStockRows()
    : roomId === null
      ? []
      : await getRoomStockRows(roomId);

  const pendingFilters = [eq(requests.status, "submitted")];
  if (role !== "admin" && userId) pendingFilters.push(eq(requests.createdBy, userId));

  const pendingRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(requests)
    .where(and(...pendingFilters));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const incomingFilter = [
    eq(stockMovements.movementType, "in"),
    gte(stockMovements.createdAt, todayStart),
    role === "admin" ? isNull(stockMovements.roomId) : roomId === null ? sql`FALSE` : eq(stockMovements.roomId, roomId),
  ];

  const incomingToday = await db
    .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)` })
    .from(stockMovements)
    .where(and(...incomingFilter));

  const recentFilter = role === "admin"
    ? isNull(stockMovements.roomId)
    : roomId === null
      ? sql`FALSE`
      : eq(stockMovements.roomId, roomId);

  const recent = await db
    .select({ movement: stockMovements, item: items })
    .from(stockMovements)
    .leftJoin(items, eq(stockMovements.itemId, items.id))
    .where(recentFilter)
    .orderBy(desc(stockMovements.createdAt))
    .limit(10);

  let roomName: string | null = null;
  if (role !== "admin" && roomId !== null) {
    const roomRows = await db
      .select({ name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);
    roomName = roomRows[0]?.name ?? null;
  }

  return {
    scope: role === "admin" ? "warehouse" : "room",
    roomId,
    roomName,
    stats: {
      items: stock.length,
      lowStock: stock.filter((row) => isLowStock(Number(row.movementQty), row.minStock)).length,
      pending: Number(pendingRows[0]?.count ?? 0),
      todayIn: Number(incomingToday[0]?.qty ?? 0),
    },
    stock,
    recent,
  };
}

export async function writeAudit(actorId: number, action: string, entityType: string, entityId: number | null, beforeData: unknown, afterData: unknown, notes?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({ actorId, action, entityType, entityId, beforeData, afterData, notes });
}

export async function getReportMovements(from?: Date, to?: Date) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (from) filters.push(gte(stockMovements.occurredAt, from));
  if (to) filters.push(lte(stockMovements.occurredAt, to));
  return db.select({ movement: stockMovements, item: items, room: rooms, warehouse: warehouses }).from(stockMovements).leftJoin(items, eq(stockMovements.itemId, items.id)).leftJoin(rooms, eq(stockMovements.roomId, rooms.id)).leftJoin(warehouses, eq(stockMovements.sourceWarehouseId, warehouses.id)).where(filters.length ? and(...filters) : undefined).orderBy(desc(stockMovements.occurredAt));
}


export async function getMonthlyReportData(monthKey: string) {
  const db = await getDb();
  if (!db) {
    return {
      monthKey,
      daysInMonth: 0,
      items: [],
      rooms: [],
      openingWarehouse: [],
      openingRooms: [],
      movements: [],
    };
  }

  if (!/^\\d{4}-\\d{2}$/.test(monthKey)) {
    throw new Error("Format bulan harus YYYY-MM");
  }

  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Bulan tidak valid");
  }

  const start = new Date(`${monthKey}-01T00:00:00+07:00`);
  const nextMonth = month === 12
    ? new Date(`${year + 1}-01-01T00:00:00+07:00`)
    : new Date(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00+07:00`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const [activeItems, activeRooms, openingWarehouseRows, openingRoomRows, monthlyMovements] = await Promise.all([
    db.select({
      id: items.id,
      sku: items.sku,
      name: items.name,
      category: items.category,
      unit: items.unit,
      minStock: items.minStock,
      sourceWarehouseId: items.sourceWarehouseId,
    }).from(items).where(eq(items.active, true)).orderBy(items.name),
    db.select({
      id: rooms.id,
      code: rooms.code,
      name: rooms.name,
    }).from(rooms).where(eq(rooms.active, true)).orderBy(rooms.name),
    db.select({
      itemId: stockMovements.itemId,
      quantity: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)`,
    })
      .from(stockMovements)
      .where(and(
        isNull(stockMovements.roomId),
        lt(stockMovements.occurredAt, start),
      ))
      .groupBy(stockMovements.itemId),
    db.select({
      roomId: stockMovements.roomId,
      itemId: stockMovements.itemId,
      quantity: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)`,
    })
      .from(stockMovements)
      .where(and(
        sql`${stockMovements.roomId} IS NOT NULL`,
        lt(stockMovements.occurredAt, start),
      ))
      .groupBy(stockMovements.roomId, stockMovements.itemId),
    db.select({
      movement: stockMovements,
      item: items,
      room: rooms,
      warehouse: warehouses,
    })
      .from(stockMovements)
      .leftJoin(items, eq(stockMovements.itemId, items.id))
      .leftJoin(rooms, eq(stockMovements.roomId, rooms.id))
      .leftJoin(warehouses, eq(stockMovements.sourceWarehouseId, warehouses.id))
      .where(and(
        gte(stockMovements.occurredAt, start),
        lt(stockMovements.occurredAt, nextMonth),
      ))
      .orderBy(stockMovements.occurredAt),
  ]);

  return {
    monthKey,
    daysInMonth,
    items: activeItems,
    rooms: activeRooms,
    openingWarehouse: openingWarehouseRows.map((row) => ({
      itemId: row.itemId,
      quantity: Number(row.quantity ?? 0),
    })),
    openingRooms: openingRoomRows.map((row) => ({
      roomId: row.roomId,
      itemId: row.itemId,
      quantity: Number(row.quantity ?? 0),
    })),
    movements: monthlyMovements,
  };
}

export { auditLogs, items, requestDayLocks, requestItems, requests, rooms, stockAdjustments, stockMovements, users, warehouses };