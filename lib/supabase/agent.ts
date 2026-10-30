import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// The agent has no signed-in user: requests run as anon carrying the raw grant
// token in the x-agent-grant header, and the agent_grant read policies are the
// only thing that turn it into rows. There is deliberately no accessToken —
// anon is the whole point.
export function createSupabaseAgentClient(token: string) {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: { headers: { "x-agent-grant": token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
