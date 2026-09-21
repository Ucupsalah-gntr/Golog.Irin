import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export default async function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  const connectionString = String(process.env.DATABASE_URL ?? "").trim();
  if (!connectionString) {
    res.status(200).json({ ok: false, reason: "DATABASE_URL-missing" });
    return;
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    const db = drizzle(pool);
    const result = await db.execute("select 1 as ok");
    res.status(200).json({
      ok: true,
      drizzleLoaded: true,
      queryOk: true,
      row: result.rows?.[0] ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Drizzle Check] failed:", error);
    res.status(200).json({
      ok: false,
      drizzleLoaded: true,
      reason: error instanceof Error ? error.message : "drizzle-check-failed",
      timestamp: new Date().toISOString(),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}
