import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { env } from "@/lib/env";

export async function createSupabaseServerClient() {
  const { getToken } = await auth();

  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => getToken(),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
