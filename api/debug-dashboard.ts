import { getDashboardData } from "../server/db";

export default async function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  try {
    const data = await getDashboardData();
    res.status(200).json({
      ok: true,
      stats: data.stats,
      stockCount: data.stock.length,
      recentCount: data.recent.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Debug Dashboard] failed:", error);
    res.status(200).json({
      ok: false,
      reason: error instanceof Error ? error.message : "dashboard-debug-failed",
      timestamp: new Date().toISOString(),
    });
  }
}
