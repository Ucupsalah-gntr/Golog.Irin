import "dotenv/config";
import express from "express";
import { Pool } from "pg";

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let healthPool: Pool | null = null;

const health = async (_req: express.Request, res: express.Response) => {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  const supabaseUrl = String(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
  const supabaseKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  ).trim();
  const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);
  let databaseReachable = false;

  if (databaseUrl) {
    try {
      healthPool ??= new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 3000,
        ssl: { rejectUnauthorized: false },
      });
      await healthPool.query("SELECT 1");
      databaseReachable = true;
    } catch (error) {
      console.warn("[Health] Database readiness probe failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  const ok = Boolean(databaseUrl && supabaseConfigured && databaseReachable);
  return res.status(ok ? 200 : 503).json({
    ok,
    service: "gologirin-api",
    checks: {
      supabaseConfigured,
      databaseConfigured: Boolean(databaseUrl),
      databaseReachable,
    },
    timestamp: new Date().toISOString(),
  });
};

app.get("/", health);
app.get("/health", health);
app.get("/api/health", health);

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({
    ok: false,
    error: "NOT_FOUND",
    message: "Endpoint API tidak ditemukan.",
  });
});

export default app;
