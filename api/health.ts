import { Pool } from "pg";

type HealthRequest = { method?: string };
type HealthResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

let pool: Pool | null = null;

export default async function handler(
  _req: HealthRequest,
  res: HealthResponse,
) {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  const supabaseUrl = String(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
  const supabaseKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  ).trim();
  const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);
  let databaseReachable = false;

  if (databaseUrl) {
    try {
      pool ??= new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 3000,
        ssl: { rejectUnauthorized: false },
      });
      await pool.query("SELECT 1");
      databaseReachable = true;
    } catch (error) {
      console.warn("[Health] Database readiness probe failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  const ok = Boolean(databaseUrl && supabaseConfigured && databaseReachable);
  return res.status(ok ? 200 : 503).json({
    ok,
    service: "gologirin-api-health",
    checks: {
      supabaseConfigured,
      databaseConfigured: Boolean(databaseUrl),
      databaseReachable,
    },
    timestamp: new Date().toISOString(),
  });
}
