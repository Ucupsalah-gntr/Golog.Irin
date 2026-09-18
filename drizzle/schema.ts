import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  authUserId: uuid("auth_user_id").unique(),
  role: text("role").$type<"user" | "admin">().default("user").notNull(),
  roomId: integer("roomId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  roomIdx: uniqueIndex("users_room_lookup_idx").on(table.roomId),
}));

export const warehouses = pgTable("warehouses", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: text("kind").$type<"source" | "logistics">().default("source").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const rooms = pgTable("rooms", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const items = pgTable("items", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  sku: varchar("sku", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }),
  unit: varchar("unit", { length: 32 }).notNull(),
  sourceWarehouseId: integer("sourceWarehouseId"),
  minStock: integer("minStock").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const requests = pgTable("requests", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  requestNo: varchar("requestNo", { length: 40 }).notNull().unique(),
  roomId: integer("roomId").notNull(),
  createdBy: integer("createdBy").notNull(),
  priority: text("priority").$type<"normal" | "mendesak" | "darurat">().default("normal").notNull(),
  status: text("status").$type<"draft" | "submitted" | "approved" | "partial" | "rejected" | "ready" | "delivered" | "received" | "cancelled">().default("draft").notNull(),
  notes: text("notes"),
  submittedAt: timestamp("submittedAt", { withTimezone: true }),
  verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
  deliveredAt: timestamp("deliveredAt", { withTimezone: true }),
  receivedAt: timestamp("receivedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const requestDayLocks = pgTable("request_day_locks", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  roomId: integer("roomId").notNull(),
  requestDate: varchar("requestDate", { length: 10 }).notNull(),
  requesterId: integer("requesterId").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  roomDateUnique: uniqueIndex("request_day_locks_room_date_unique").on(table.roomId, table.requestDate),
}));

export const requestItems = pgTable("request_items", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  requestId: integer("requestId").notNull(),
  itemId: integer("itemId").notNull(),
  requestedQty: integer("requestedQty").notNull(),
  approvedQty: integer("approvedQty").default(0).notNull(),
  deliveredQty: integer("deliveredQty").default(0).notNull(),
});

export const stockMovements = pgTable("stock_movements", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  itemId: integer("itemId").notNull(),
  movementType: text("movementType").$type<"in" | "out" | "adjustment">().notNull(),
  quantity: integer("quantity").notNull(),
  sourceWarehouseId: integer("sourceWarehouseId"),
  roomId: integer("roomId"),
  requestId: integer("requestId"),
  adjustmentId: integer("adjustmentId"),
  notes: text("notes"),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).defaultNow().notNull(),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const stockAdjustments = pgTable("stock_adjustments", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  adjustmentNo: varchar("adjustmentNo", { length: 40 }).notNull().unique(),
  itemId: integer("itemId").notNull(),
  roomId: integer("roomId"),
  adjustmentType: text("adjustmentType").$type<"add" | "subtract">().notNull(),
  quantity: integer("quantity").notNull(),
  systemQty: integer("systemQty").notNull(),
  physicalQty: integer("physicalQty").notNull(),
  reasonType: text("reasonType").$type<"forgotten_entry" | "holiday_pickup" | "damaged" | "expired" | "emergency" | "stocktake" | "other">().notNull(),
  reason: text("reason").notNull(),
  incidentDate: timestamp("incidentDate", { withTimezone: true }).notNull(),
  status: text("status").$type<"draft" | "applied" | "rejected">().default("draft").notNull(),
  createdBy: integer("createdBy").notNull(),
  verifiedBy: integer("verifiedBy"),
  appliedAt: timestamp("appliedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  actorId: integer("actorId").notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: integer("entityId"),
  beforeData: jsonb("beforeData"),
  afterData: jsonb("afterData"),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Item = typeof items.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestItem = typeof requestItems.$inferSelect;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;
