import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers.ts";
import { createContext } from "../server/_core/context.ts";

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

// Vercel can invoke this Express app with either the /api prefix
// or a path relative to the /api serverless function.
app.get("/", health);
app.get("/health", health);
app.get("/api/health", health);

// tRPC is exposed under both possible mount paths for Vercel routing.
const trpcMiddleware = createExpressMiddleware({
  router: appRouter,
  createContext,
});

app.use("/trpc", trpcMiddleware);
app.use("/api/trpc", trpcMiddleware);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[API] Unhandled Express error:", error);

  if (res.headersSent) return;

  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "API server error. Check Vercel function logs.",
  });
});

export default app;
