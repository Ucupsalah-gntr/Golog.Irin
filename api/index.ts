import "dotenv/config";
import express from "express";

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const health = (_req: express.Request, res: express.Response) => {
  res.status(200).json({
    ok: true,
    service: "gologirin-api",
    supabaseConfigured: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
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
