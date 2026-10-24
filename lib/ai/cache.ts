import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL } from "./client.ts";

export type CacheKind = "file-explanation" | "folder-explanation" | "classification";

// The key covers everything that shapes the answer: kind, prompt version and
// model first (by convention every caller's parts start with them), then the
// content the answer is about. Rows are never updated — a different input is
// a different key.
export function cacheKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// The client parameter decides the auth boundary: interactive calls pass the
// user-token client (RLS by org claim), the pipeline passes its secret client.
export async function readCache(
  client: SupabaseClient,
  organizationId: string,
  keys: string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const { data, error } = await client
    .from("ai_cache")
    .select("cache_key, content")
    .eq("organization_id", organizationId)
    .in("cache_key", keys);
  if (error) throw new Error(`Could not read AI cache: ${error.message}`);
  return new Map(((data ?? []) as Array<{ cache_key: string; content: string }>).map((row) => [row.cache_key, row.content]));
}

export async function writeCache(
  client: SupabaseClient,
  rows: Array<{ organization_id: string; kind: CacheKind; cache_key: string; content: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .from("ai_cache")
    .upsert(rows.map((row) => ({ ...row, model: MODEL })), {
      onConflict: "organization_id,cache_key",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`Could not write AI cache: ${error.message}`);
}
