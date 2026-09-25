import { createClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

if (!url || !key) {
  console.warn("[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY belum dikonfigurasi.");
}

// Each browser tab gets its own Supabase auth storage and BroadcastChannel key.
// sessionStorage is isolated per tab, while a per-load storageKey prevents
// Supabase auth events from one tab from switching another tab's session.
const TAB_STORAGE_PREFIX = "gologirin-auth-session:";
const TAB_STORAGE_KEY =
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const tabSessionStorage: Storage = {
  getItem(keyName: string) {
    return sessionStorage.getItem(TAB_STORAGE_PREFIX + keyName);
  },
  setItem(keyName: string, value: string) {
    sessionStorage.setItem(TAB_STORAGE_PREFIX + keyName, value);
  },
  removeItem(keyName: string) {
    sessionStorage.removeItem(TAB_STORAGE_PREFIX + keyName);
  },
};

export const supabase = createClient(url || "https://invalid.local", key || "invalid", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: tabSessionStorage,
    storageKey: `gologirin-${TAB_STORAGE_KEY}`,
  },
});

export function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@gologirin.local`;
}
