import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

export const supabaseServer = createClient(
  ENV.supabaseUrl,
  ENV.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);
