// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var warehouses = mysqlTable("warehouses", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: mysqlEnum("kind", ["source", "logistics"]).default("source").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var rooms = mysqlTable("rooms", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var items = mysqlTable("items", {
  id: int("id").autoincrement().primaryKey(),
  sku: varchar("sku", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }),
  unit: varchar("unit", { length: 32 }).notNull(),
  sourceWarehouseId: int("sourceWarehouseId"),
  minStock: int("minStock").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var requests = mysqlTable("requests", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var requestItems = mysqlTable("request_items", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull(),
  itemId: int("itemId").notNull(),
  requestedQty: int("requestedQty").notNull(),
  approvedQty: int("approvedQty").default(0).notNull(),
  deliveredQty: int("deliveredQty").default(0).notNull()
});
var stockMovements = mysqlTable("stock_movements", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var stockAdjustments = mysqlTable("stock_adjustments", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorId: int("actorId").notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: int("entityId"),
  beforeData: json("beforeData"),
  afterData: json("afterData"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// shared/inventory.ts
function isLowStock(current, minimum) {
  return current <= minimum;
}

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  for (const field of ["name", "email", "loginMethod"]) {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= /* @__PURE__ */ new Date();
  updateSet.lastSignedIn ??= values.lastSignedIn;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function ensureCatalog() {
  const db = await getDb();
  if (!db) return;
  const currentWarehouses = await db.select().from(warehouses);
  if (!currentWarehouses.length) {
    await db.insert(warehouses).values([
      { code: "FARMASI", name: "Gudang Farmasi", kind: "source" },
      { code: "GUDANG-RT", name: "Gudang RT", kind: "source" },
      { code: "CSSD", name: "CSSD", kind: "source" },
      { code: "LAB", name: "Laboratorium", kind: "source" },
      { code: "LOGISTIK-IR", name: "Gudang Logistik IR", kind: "logistics" }
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
      { code: "ICU-REGULER", name: "ICU Reguler" }
    ]);
  }
}
async function getStockRows() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    itemId: items.id,
    sku: items.sku,
    name: items.name,
    category: items.category,
    unit: items.unit,
    minStock: items.minStock,
    movementQty: sql`COALESCE(SUM(${stockMovements.quantity}), 0)`
  }).from(items).leftJoin(stockMovements, eq(stockMovements.itemId, items.id)).where(eq(items.active, true)).groupBy(items.id, items.sku, items.name, items.category, items.unit, items.minStock).orderBy(items.name);
}
async function getStockQty(itemId) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ qty: sql`COALESCE(SUM(${stockMovements.quantity}), 0)` }).from(stockMovements).where(eq(stockMovements.itemId, itemId));
  return Number(rows[0]?.qty ?? 0);
}
async function getDashboardData() {
  const db = await getDb();
  if (!db) return { stats: { items: 0, lowStock: 0, pending: 0, todayIn: 0 }, stock: [], recent: [] };
  const stock = await getStockRows();
  const pendingRows = await db.select({ count: sql`COUNT(*)` }).from(requests).where(eq(requests.status, "submitted"));
  const todayStart = /* @__PURE__ */ new Date();
  todayStart.setHours(0, 0, 0, 0);
  const incomingToday = await db.select({ qty: sql`COALESCE(SUM(${stockMovements.quantity}), 0)` }).from(stockMovements).where(and(eq(stockMovements.movementType, "in"), gte(stockMovements.createdAt, todayStart)));
  const recent = await db.select({ movement: stockMovements, item: items }).from(stockMovements).leftJoin(items, eq(stockMovements.itemId, items.id)).orderBy(desc(stockMovements.createdAt)).limit(10);
  return {
    stats: {
      items: stock.length,
      lowStock: stock.filter((row) => isLowStock(Number(row.movementQty), row.minStock)).length,
      pending: Number(pendingRows[0]?.count ?? 0),
      todayIn: Number(incomingToday[0]?.qty ?? 0)
    },
    stock,
    recent
  };
}
async function writeAudit(actorId, action, entityType, entityId, beforeData, afterData, notes) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({ actorId, action, entityType, entityId, beforeData, afterData, notes });
}
async function getReportMovements(from, to) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (from) filters.push(gte(stockMovements.occurredAt, from));
  if (to) filters.push(lte(stockMovements.occurredAt, to));
  return db.select({ movement: stockMovements, item: items, room: rooms, warehouse: warehouses }).from(stockMovements).leftJoin(items, eq(stockMovements.itemId, items.id)).leftJoin(rooms, eq(stockMovements.roomId, rooms.id)).leftJoin(warehouses, eq(stockMovements.sourceWarehouseId, warehouses.id)).where(filters.length ? and(...filters) : void 0).orderBy(desc(stockMovements.occurredAt));
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { and as and2, desc as desc2, eq as eq2 } from "drizzle-orm";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var roleGuard = (role) => protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== role && !(role === "user" && ctx.user.role === "admin")) {
    throw new TRPCError3({ code: "FORBIDDEN", message: "Anda tidak memiliki akses ke aksi ini." });
  }
  return next();
});
var operatorProcedure = roleGuard("user");
function nowNo(prefix) {
  return `${prefix}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString().slice(-5)}`;
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  catalog: router({
    all: protectedProcedure.query(async () => {
      await ensureCatalog();
      const db = await getDb();
      if (!db) return { rooms: [], warehouses: [], items: [] };
      return {
        rooms: await db.select().from(rooms).where(eq2(rooms.active, true)).orderBy(rooms.name),
        warehouses: await db.select().from(warehouses).where(eq2(warehouses.active, true)).orderBy(warehouses.name),
        items: await db.select().from(items).where(eq2(items.active, true)).orderBy(items.name)
      };
    }),
    createItem: adminProcedure.input(z2.object({ sku: z2.string().min(1), name: z2.string().min(2), unit: z2.string().min(1), category: z2.string().optional(), sourceWarehouseId: z2.number().nullable().optional(), minStock: z2.number().int().min(0).default(0) })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const result = await db.insert(items).values(input);
      await writeAudit(ctx.user.id, "create", "item", Number(result[0].insertId), null, input, "Master barang dibuat");
      return { id: Number(result[0].insertId) };
    })
  }),
  dashboard: router({
    summary: protectedProcedure.query(async () => getDashboardData())
  }),
  inbound: router({
    create: adminProcedure.input(z2.object({ itemId: z2.number().int(), quantity: z2.number().int().positive(), sourceWarehouseId: z2.number().int(), occurredAt: z2.coerce.date().optional(), notes: z2.string().max(500).optional() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const result = await db.insert(stockMovements).values({ ...input, movementType: "in", createdBy: ctx.user.id, occurredAt: input.occurredAt ?? /* @__PURE__ */ new Date() });
      await writeAudit(ctx.user.id, "create", "stock_movement", Number(result[0].insertId), null, input, "Barang masuk dicatat");
      return { id: Number(result[0].insertId) };
    })
  }),
  requests: router({
    list: protectedProcedure.input(z2.object({ status: z2.string().optional(), roomId: z2.number().optional() }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const filters = [];
      if (input?.status) filters.push(eq2(requests.status, input.status));
      if (input?.roomId) filters.push(eq2(requests.roomId, input.roomId));
      const rows = await db.select({ request: requests, room: rooms }).from(requests).leftJoin(rooms, eq2(requests.roomId, rooms.id)).where(filters.length ? and2(...filters) : void 0).orderBy(desc2(requests.createdAt)).limit(100);
      const result = [];
      for (const row of rows) {
        const lines = await db.select({ line: requestItems, item: items }).from(requestItems).leftJoin(items, eq2(requestItems.itemId, items.id)).where(eq2(requestItems.requestId, row.request.id));
        result.push({ ...row, lines });
      }
      return result;
    }),
    create: operatorProcedure.input(z2.object({ roomId: z2.number().int(), priority: z2.enum(["normal", "mendesak", "darurat"]), notes: z2.string().max(1e3).optional(), lines: z2.array(z2.object({ itemId: z2.number().int(), requestedQty: z2.number().int().positive() })).min(1) })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const requestNo = nowNo("REQ");
      const inserted = await db.insert(requests).values({ requestNo, roomId: input.roomId, createdBy: ctx.user.id, priority: input.priority, notes: input.notes, status: "submitted", submittedAt: /* @__PURE__ */ new Date() });
      const requestId = Number(inserted[0].insertId);
      await db.insert(requestItems).values(input.lines.map((line) => ({ requestId, itemId: line.itemId, requestedQty: line.requestedQty })));
      await writeAudit(ctx.user.id, "create", "request", requestId, null, input, `Permintaan ${requestNo} diajukan`);
      return { requestId, requestNo };
    }),
    verify: adminProcedure.input(z2.object({ requestId: z2.number().int(), status: z2.enum(["approved", "partial", "rejected", "ready"]), lines: z2.array(z2.object({ lineId: z2.number().int(), approvedQty: z2.number().int().min(0) })).optional() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const existing = await db.select().from(requests).where(eq2(requests.id, input.requestId)).limit(1);
      const request = existing[0];
      if (!request) throw new TRPCError3({ code: "NOT_FOUND", message: "Permintaan tidak ditemukan." });
      if (input.lines) for (const line of input.lines) await db.update(requestItems).set({ approvedQty: line.approvedQty }).where(eq2(requestItems.id, line.lineId));
      await db.update(requests).set({ status: input.status, verifiedAt: /* @__PURE__ */ new Date() }).where(eq2(requests.id, input.requestId));
      await writeAudit(ctx.user.id, "verify", "request", input.requestId, request, { status: input.status, lines: input.lines }, "Permintaan diverifikasi kepala gudang");
      return { success: true };
    }),
    deliver: adminProcedure.input(z2.object({ requestId: z2.number().int() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const existing = await db.select().from(requests).where(eq2(requests.id, input.requestId)).limit(1);
      const request = existing[0];
      if (!request) throw new TRPCError3({ code: "NOT_FOUND", message: "Permintaan tidak ditemukan." });
      const lines = await db.select().from(requestItems).where(eq2(requestItems.requestId, input.requestId));
      for (const line of lines) {
        if (!line.approvedQty) continue;
        const available = await getStockQty(line.itemId);
        if (available < line.approvedQty) throw new TRPCError3({ code: "BAD_REQUEST", message: "Stok tidak cukup untuk salah satu item." });
        await db.insert(stockMovements).values({ itemId: line.itemId, movementType: "out", quantity: -line.approvedQty, roomId: request.roomId, requestId: request.id, createdBy: ctx.user.id, notes: `Distribusi ${request.requestNo}` });
        await db.update(requestItems).set({ deliveredQty: line.approvedQty }).where(eq2(requestItems.id, line.id));
      }
      await db.update(requests).set({ status: "delivered", deliveredAt: /* @__PURE__ */ new Date() }).where(eq2(requests.id, input.requestId));
      await writeAudit(ctx.user.id, "deliver", "request", input.requestId, request, { status: "delivered" }, "Barang diserahkan ke ruangan");
      return { success: true };
    }),
    receive: protectedProcedure.input(z2.object({ requestId: z2.number().int() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      await db.update(requests).set({ status: "received", receivedAt: /* @__PURE__ */ new Date() }).where(eq2(requests.id, input.requestId));
      await writeAudit(ctx.user.id, "receive", "request", input.requestId, null, { status: "received" }, "Penerimaan barang dikonfirmasi");
      return { success: true };
    })
  }),
  adjustments: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({ adjustment: stockAdjustments, item: items, room: rooms }).from(stockAdjustments).leftJoin(items, eq2(stockAdjustments.itemId, items.id)).leftJoin(rooms, eq2(stockAdjustments.roomId, rooms.id)).orderBy(desc2(stockAdjustments.createdAt)).limit(100);
    }),
    applyAdjustment: adminProcedure.input(z2.object({ itemId: z2.number().int(), roomId: z2.number().int().nullable().optional(), adjustmentType: z2.enum(["add", "subtract"]), quantity: z2.number().int().positive(), physicalQty: z2.number().int().min(0), reasonType: z2.enum(["forgotten_entry", "holiday_pickup", "damaged", "expired", "emergency", "stocktake", "other"]), reason: z2.string().min(10), incidentDate: z2.coerce.date() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const systemQty = await getStockQty(input.itemId);
      if (input.adjustmentType === "subtract" && input.quantity > systemQty) throw new TRPCError3({ code: "BAD_REQUEST", message: "Penyesuaian pengurangan melebihi stok sistem." });
      const adjustmentNo = nowNo("ADJ");
      const inserted = await db.insert(stockAdjustments).values({ ...input, adjustmentNo, systemQty, status: "applied", createdBy: ctx.user.id, verifiedBy: ctx.user.id, appliedAt: /* @__PURE__ */ new Date() });
      const adjustmentId = Number(inserted[0].insertId);
      const signedQty = input.adjustmentType === "add" ? input.quantity : -input.quantity;
      await db.insert(stockMovements).values({ itemId: input.itemId, movementType: "adjustment", quantity: signedQty, roomId: input.roomId, adjustmentId, createdBy: ctx.user.id, notes: input.reason, occurredAt: input.incidentDate });
      await writeAudit(ctx.user.id, "apply", "stock_adjustment", adjustmentId, { systemQty }, { ...input, adjustmentNo, status: "applied", verifiedBy: ctx.user.id }, "Self-verification kepala gudang");
      return { adjustmentId, adjustmentNo };
    })
  }),
  reports: router({
    movements: protectedProcedure.input(z2.object({ from: z2.coerce.date().optional(), to: z2.coerce.date().optional() }).optional()).query(({ input }) => getReportMovements(input?.from, input?.to))
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
