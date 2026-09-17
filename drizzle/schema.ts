import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  roomId: int("roomId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const warehouses = mysqlTable("warehouses", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: mysqlEnum("kind", ["source", "logistics"]).default("source").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const rooms = mysqlTable("rooms", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const items = mysqlTable("items", {
  id: int("id").autoincrement().primaryKey(),
  sku: varchar("sku", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }),
  unit: varchar("unit", { length: 32 }).notNull(),
  sourceWarehouseId: int("sourceWarehouseId"),
  minStock: int("minStock").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const requests = mysqlTable("requests", {
  id: int("id").autoincrement().primaryKey(),
  requestNo: varchar("requestNo", { length: 40 }).notNull().unique(),
  roomId: int("roomId").notNull(),
  createdBy: int("createdBy").notNull(),
  priority: mysqlEnum("priority", ["normal", "mendesak", "darurat"]).default("normal").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "approved", "partial", "rejected", "ready", "delivered", "received", "cancelled"]).default("draft").notNull(),
  notes: text("notes"),
  submittedAt: timestamp("submittedAt"),
  verifiedAt: timestamp("verifiedAt"),
  deliveredAt: timestamp("deliveredAt"),
  receivedAt: timestamp("receivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const requestItems = mysqlTable("request_items", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull(),
  itemId: int("itemId").notNull(),
  requestedQty: int("requestedQty").notNull(),
  approvedQty: int("approvedQty").default(0).notNull(),
  deliveredQty: int("deliveredQty").default(0).notNull(),
});

export const stockMovements = mysqlTable("stock_movements", {
  id: int("id").autoincrement().primaryKey(),
  itemId: int("itemId").notNull(),
  movementType: mysqlEnum("movementType", ["in", "out", "adjustment"]).notNull(),
  quantity: int("quantity").notNull(),
  sourceWarehouseId: int("sourceWarehouseId"),
  roomId: int("roomId"),
  requestId: int("requestId"),
  adjustmentId: int("adjustmentId"),
  notes: text("notes"),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const stockAdjustments = mysqlTable("stock_adjustments", {
  id: int("id").autoincrement().primaryKey(),
  adjustmentNo: varchar("adjustmentNo", { length: 40 }).notNull().unique(),
  itemId: int("itemId").notNull(),
  roomId: int("roomId"),
  adjustmentType: mysqlEnum("adjustmentType", ["add", "subtract"]).notNull(),
  quantity: int("quantity").notNull(),
  systemQty: int("systemQty").notNull(),
  physicalQty: int("physicalQty").notNull(),
  reasonType: mysqlEnum("reasonType", ["forgotten_entry", "holiday_pickup", "damaged", "expired", "emergency", "stocktake", "other"]).notNull(),
  reason: text("reason").notNull(),
  incidentDate: timestamp("incidentDate").notNull(),
  status: mysqlEnum("status", ["draft", "applied", "rejected"]).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  verifiedBy: int("verifiedBy"),
  appliedAt: timestamp("appliedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorId: int("actorId").notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: int("entityId"),
  beforeData: json("beforeData"),
  afterData: json("afterData"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Item = typeof items.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestItem = typeof requestItems.$inferSelect;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;
