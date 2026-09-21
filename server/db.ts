import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
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
} from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";
import { isLowStock } from "../shared/inventory.js";

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

export async function getStockRows() {
  const db = await getDb();
  if (!db) return [];
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
    .leftJoin(stockMovements, eq(stockMovements.itemId, items.id))
    .where(eq(items.active, true))
    .groupBy(items.id, items.sku, items.name, items.category, items.unit, items.minStock)
    .orderBy(items.name);
}

export async function getStockQty(itemId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ qty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.itemId, itemId));
  return Number(rows[0]?.qty ?? 0);
}

export async function getDashboardData() {
  const db = await getDb();
  if (!db) return { stats: { items: 0, lowStock: 0, pending: 0, todayIn: 0 }, stock: [], recent: [] };
  const stock = await getStockRows();
  const pendingRows = await db.select({ count: sql<number>`COUNT(*)` }).from(requests).where(eq(requests.status, "submitted"));
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const incomingToday = await db.select({ qty: sql<number>`COALESCE(SUM(${stockMovements.quantity}), 0)` }).from(stockMovements).where(and(eq(stockMovements.movementType, "in"), gte(stockMovements.createdAt, todayStart)));
  const recent = await db.select({ movement: stockMovements, item: items }).from(stockMovements).leftJoin(items, eq(stockMovements.itemId, items.id)).orderBy(desc(stockMovements.createdAt)).limit(10);
  return {
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

export { auditLogs, items, requestDayLocks, requestItems, requests, rooms, stockAdjustments, stockMovements, users, warehouses };