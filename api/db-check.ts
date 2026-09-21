import { Pool } from "pg";

export default async function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  const connectionString = String(process.env.DATABASE_URL ?? "").trim();

  if (!connectionString) {
    res.status(200).json({
      ok: true,
      databaseConfigured: false,
      databaseReachable: false,
      reason: "DATABASE_URL-missing",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await pool.query("select 1 as ok");
    res.status(200).json({
      ok: true,
      databaseConfigured: true,
      databaseReachable: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DB Check] failed:", error);
    res.status(200).json({
      ok: true,
      databaseConfigured: true,
      databaseReachable: false,
      reason: error instanceof Error ? error.message : "database-check-failed",
      timestamp: new Date().toISOString(),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}
