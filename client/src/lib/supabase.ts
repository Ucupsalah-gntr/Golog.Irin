import { createClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

if (!url || !key) {
  console.warn("[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY belum dikonfigurasi.");
}

export const supabase = createClient(url || "https://invalid.local", key || "invalid", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@gologirin.local`;
}
