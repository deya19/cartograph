import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Runs outlive the 60-second Clerk access token, and the analyze script has no
// session at all, so pipeline writes use the secret key. This client is for
// pipeline writes only — reads elsewhere stay on the user token and RLS, so
// nothing outside lib/pipeline may import this.
export function createPipelineClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
