import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

export default async function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  try {
    const db = await getDb();
    if (!db) {
      res.status(200).json({
        ok: true,
        service: "gologirin-api-health",
        databaseConfigured,
        databaseReachable: false,
        reason: databaseConfigured ? "database-connection-not-created" : "DATABASE_URL-missing",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await db.execute(sql`select 1 as ok`);

    res.status(200).json({
      ok: true,
      service: "gologirin-api-health",
      databaseConfigured,
      databaseReachable: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    res.status(200).json({
      ok: true,
      service: "gologirin-api-health",
      databaseConfigured,
      databaseReachable: false,
      reason: error instanceof Error ? error.message : "database-check-failed",
      timestamp: new Date().toISOString(),
    });
  }
}
