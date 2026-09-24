import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGoogleSheetSyncData } from "../../../server/db.ts";

function getSyncToken(req: VercelRequest) {
  const header = req.headers["x-golog-sync-token"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    const data = await getGoogleSheetSyncData();
    return res.status(200).json({
      ok: true,
      service: "gologirin-google-sheet-sync",
      ...data,
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
