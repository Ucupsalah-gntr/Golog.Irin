import { Pool } from "pg";

type SyncRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type SyncResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => unknown };
};

let pool: Pool | null = null;

function getSyncToken(req: SyncRequest) {
  const header = req.headers["x-golog-sync-token"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

function getPool() {
  if (pool) return pool;

  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL belum dikonfigurasi di Vercel.");
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

export default async function handler(req: SyncRequest, res: SyncResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Gunakan GET atau POST.",
    });
  }

  const configuredToken = String(process.env.GOOGLE_SHEET_SYNC_TOKEN ?? "").trim();
  if (!configuredToken) {
    return res.status(503).json({
      ok: false,
      error: "SYNC_NOT_CONFIGURED",
      message: "GOOGLE_SHEET_SYNC_TOKEN belum dikonfigurasi.",
    });
  }

  const providedToken = getSyncToken(req);
  if (!providedToken || providedToken !== configuredToken) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
      message: "Token sinkronisasi tidak valid.",
    });
  }

  try {
    const db = getPool();
    const historyStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [stockResult, itemsResult, requestResult, movementResult] = await Promise.all([
      db.query(
        `SELECT
           i.sku,
           i.name,
           i.category,
           i.unit,
           i."minStock" AS "minStock",
           COALESCE(SUM(sm.quantity), 0)::int AS "stockQty"
         FROM items i
         LEFT JOIN stock_movements sm
           ON sm."itemId" = i.id
          AND sm."roomId" IS NULL
         WHERE i.active = TRUE
         GROUP BY i.id, i.sku, i.name, i.category, i.unit, i."minStock"
         ORDER BY i.name`,
      ),
      db.query(
        `SELECT
           sku,
           name,
           category,
           unit,
           "minStock"
         FROM items
         WHERE active = TRUE
         ORDER BY name`,
      ),
      db.query(
        `SELECT
           r.id,
           r."requestNo" AS "requestNo",
           r.priority,
           r.status,
           r.notes,
           r."createdAt" AS "createdAt",
           COALESCE(ro.name, 'Ruangan') AS room
         FROM requests r
         LEFT JOIN rooms ro ON ro.id = r."roomId"
         WHERE r."createdAt" >= $1
         ORDER BY r."createdAt" DESC
         LIMIT 100`,
        [historyStart],
      ),
      db.query(
        `SELECT
           sm."occurredAt" AS "occurredAt",
           sm."movementType" AS "movementType",
           sm.quantity,
           sm."roomId" AS "roomId",
           sm."requestId" AS "requestId",
           sm.notes,
           i.sku,
           i.name AS "itemName",
           COALESCE(ro.name, '') AS room,
           COALESCE(w.name, 'Gudang Pusat') AS warehouse,
           COALESCE(r."requestNo", '') AS "requestNo"
         FROM stock_movements sm
         LEFT JOIN items i ON i.id = sm."itemId"
         LEFT JOIN rooms ro ON ro.id = sm."roomId"
         LEFT JOIN warehouses w ON w.id = sm."sourceWarehouseId"
         LEFT JOIN requests r ON r.id = sm."requestId"
         WHERE sm."occurredAt" >= $1
         ORDER BY sm."occurredAt" DESC
         LIMIT 5000`,
        [historyStart],
      ),
    ]);

    const requestRows = requestResult.rows;
    const requestIds = requestRows.map((row) => row.id);

    let requestLineRows: Array<{
      requestId: number;
      requestedQty: number;
      approvedQty: number;
      sku: string | null;
      itemName: string | null;
    }> = [];

    if (requestIds.length) {
      const lineResult = await db.query(
        `SELECT
           ri."requestId" AS "requestId",
           ri."requestedQty" AS "requestedQty",
           ri."approvedQty" AS "approvedQty",
           i.sku,
           i.name AS "itemName"
         FROM request_items ri
         LEFT JOIN items i ON i.id = ri."itemId"
         WHERE ri."requestId" = ANY($1::int[])`,
        [requestIds],
      );
      requestLineRows = lineResult.rows;
    }

    const requestById = new Map<number, (typeof requestRows)[number]>();
    for (const row of requestRows) requestById.set(Number(row.id), row);

    return res.status(200).json({
      ok: true,
      service: "gologirin-google-sheet-sync",
      syncVersion: 1,
      generatedAt: new Date().toISOString(),
      historyDays: 90,
      stock: stockResult.rows.map((row) => ({
        sku: row.sku,
        name: row.name,
        category: row.category ?? "",
        unit: row.unit,
        stockQty: Number(row.stockQty ?? 0),
        minStock: Number(row.minStock ?? 0),
      })),
      items: itemsResult.rows.map((row) => ({
        sku: row.sku,
        name: row.name,
        category: row.category ?? "",
        unit: row.unit,
        minStock: Number(row.minStock ?? 0),
      })),
      requests: requestLineRows.map((line) => {
        const request = requestById.get(Number(line.requestId));
        return {
          date: request?.createdAt ?? null,
          requestNo: request?.requestNo ?? "",
          room: request?.room ?? "Ruangan",
          priority: request?.priority ?? "normal",
          sku: line.sku ?? "",
          itemName: line.itemName ?? "",
          requestedQty: Number(line.requestedQty ?? 0),
          approvedQty: Number(line.approvedQty ?? 0),
          status: request?.status ?? "",
        };
      }),
      distributions: movementResult.rows
        .filter((row) => row.movementType === "in" && row.roomId !== null)
        .map((row) => ({
          date: row.occurredAt,
          requestNo: row.requestNo ?? "",
          room: row.room || "Ruangan",
          sku: row.sku ?? "",
          itemName: row.itemName ?? "",
          quantity: Math.abs(Number(row.quantity ?? 0)),
        })),
      movements: movementResult.rows.map((row) => ({
        date: row.occurredAt,
        sku: row.sku ?? "",
        itemName: row.itemName ?? "",
        movementType: row.movementType ?? "",
        quantity: Number(row.quantity ?? 0),
        room: row.room ?? "",
        warehouse: row.warehouse ?? "Gudang Pusat",
        requestNo: row.requestNo ?? "",
        notes: row.notes ?? "",
      })),
    });
  } catch (error) {
    console.error("[GoogleSheetSync] failed", error);
    return res.status(500).json({
      ok: false,
      error: "SYNC_READ_FAILED",
      message: error instanceof Error ? error.message : "Data sinkronisasi gagal dibaca.",
    });
  }
}
