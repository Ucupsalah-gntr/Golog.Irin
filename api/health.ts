export default function handler(
  _req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  res.status(200).json({
    ok: true,
    service: "gologirin-api-health",
    timestamp: new Date().toISOString(),
  });
}
