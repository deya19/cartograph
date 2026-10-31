import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { UUID_PATTERN } from "../analysis/load";
import { createSupabaseServerClient } from "../supabase/server";

const GRANT_LIFETIME_MS = 10 * 60 * 1000;

// Mints a short-lived credential that lets the agent read exactly one analysis
// as anon. Only the sha256 hash is stored; the raw token is returned once and
// never written anywhere. The insert runs under the caller's own session, so
// the policy is the whole ownership check: if it fails, the analysis is not
// theirs to grant.
export async function mintAgentGrant(analysisId: string): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId || !UUID_PATTERN.test(analysisId)) return null;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("agent_grants").insert({
    organization_id: orgId,
    analysis_id: analysisId,
    token_hash: tokenHash,
    // The insert policy caps expires_at at now + 10 minutes too; this stays
    // inside that window, so a wrong clock can only shorten the grant.
    expires_at: new Date(Date.now() + GRANT_LIFETIME_MS).toISOString(),
  });

  // An insert error means the analysis is not theirs, or they are not allowed
  // to grant — either way there is nothing to return.
  if (error) return null;
  return token;
}
