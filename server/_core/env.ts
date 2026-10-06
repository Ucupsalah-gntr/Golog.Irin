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

const configuredSupabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const fallbackSupabaseUrl = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl: configuredSupabaseUrl || fallbackSupabaseUrl,
  supabasePublishableKey:
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "",
  isProduction: process.env.NODE_ENV === "production",
};
