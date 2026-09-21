import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

export default async function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  try {
    const db = await getDb();
    if (!db) {
      res.status(200).json({ ok: false, reason: "getDb-returned-null" });
      return;
    }

    const result = await db.execute(
      sql`select count(*)::int as active_items from public.items where active = true`,
    );

    res.status(200).json({
      ok: true,
      dbModuleLoaded: true,
      queryOk: true,
      row: result.rows?.[0] ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DB Module Check] failed:", error);
    res.status(200).json({
      ok: false,
      reason: error instanceof Error ? error.message : "db-module-check-failed",
      timestamp: new Date().toISOString(),
    });
  }
}
