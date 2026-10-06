function normalizeSupabaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  try {
    const url = new URL(raw);

    // A server Supabase URL must be a web URL. Reject database URLs such as
    // postgresql://... and any URL carrying credentials, which would make
    // fetch() reject the request before it ever reaches Supabase Auth.
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";

    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isModernPublishableKey(value: string) {
  return value.startsWith("sb_publishable_");
}

const configuredSupabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const fallbackSupabaseUrl = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);

const serverPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const vitePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

// Prefer a key that is explicitly a modern Supabase publishable key.
// This prevents an old/stale SUPABASE_PUBLISHABLE_KEY from shadowing the
// correct VITE_SUPABASE_PUBLISHABLE_KEY in Preview deployments.
const preferredPublishableKey = isModernPublishableKey(vitePublishableKey)
  ? vitePublishableKey
  : isModernPublishableKey(serverPublishableKey)
    ? serverPublishableKey
    : serverPublishableKey || vitePublishableKey;

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl: configuredSupabaseUrl || fallbackSupabaseUrl,
  supabasePublishableKey: preferredPublishableKey,
  isProduction: process.env.NODE_ENV === "production",
};
