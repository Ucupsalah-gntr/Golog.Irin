import "dotenv/config";
import { getGoogleSheetSyncData } from "../../server/db.ts";

type SyncRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type SyncResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => unknown };
};

function getSyncToken(req: SyncRequest) {
  const header = req.headers["x-golog-sync-token"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
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
