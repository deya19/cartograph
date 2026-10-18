"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect } from "react";

type ClerkSession = NonNullable<ReturnType<typeof useSession>["session"]>;

// One client for the whole app: supabase-js warns on multiple GoTrue/realtime
// instances, and the dashboard rows would each build one otherwise. The
// session lives in a module slot so accessToken always reads the latest token
// without the client ever changing identity — a rebuilt client would drop the
// socket mid-subscribe.
let sharedClient: SupabaseClient | null = null;
let currentSession: ClerkSession | null = null;

function client(): SupabaseClient {
  if (!sharedClient) {
    // Referenced literally: Next only inlines env vars into client bundles
    // when they appear as process.env.NAME, so lib/env.ts cannot be used here.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
    if (!key) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    // Authenticated, because both RLS and the realtime socket authorize on the
    // Clerk session token. supabase-js feeds the accessToken result to
    // realtime.setAuth itself, so the socket is authenticated the same way
    // PostgREST is.
    sharedClient = createClient(url, key, {
      accessToken: async () => (await currentSession?.getToken()) ?? null,
    });
  }
  return sharedClient;
}

export function useSupabaseBrowserClient(): { supabase: SupabaseClient; ready: boolean } {
  const { session, isLoaded } = useSession();
  useEffect(() => {
    currentSession = session ?? null;
  }, [session]);
  // ready gates subscriptions: before the session loads the token is null and
  // a private channel join would fail for a client that had no chance.
  return { supabase: client(), ready: isLoaded && !!session };
}
