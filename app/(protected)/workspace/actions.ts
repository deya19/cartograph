"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { parseGitHubUrl } from "@/lib/pipeline/github.ts";
import { runAnalysis, startAnalysis } from "@/lib/pipeline/index.ts";
import { createPipelineClient } from "@/lib/pipeline/client.ts";

export type AnalyzeFormState = {
  error: string | null;
};

export async function analyzeRepository(_prevState: AnalyzeFormState, formData: FormData): Promise<AnalyzeFormState> {
  const { orgId } = await auth();
  if (!orgId) return { error: "Select an organization before analysing a repository." };

  const url = String(formData.get("url") ?? "").trim();
  if (!parseGitHubUrl(url)) return { error: "Not a GitHub repository URL" };

  const { analysisId, existing } = await startAnalysis(orgId, url);
  if (!existing) {
    // runAnalysis writes the failed state itself; the catch only stops an
    // unhandled rejection.
    after(() => runAnalysis(analysisId).catch((error: unknown) => console.error("Analysis run failed:", error)));
  }
  // An existing analysis redirects the same way — there is no second row.
  redirect(`/workspace/analyses/${analysisId}`);
}

export async function retryAnalysis(formData: FormData): Promise<void> {
  const { orgId } = await auth();
  if (!orgId) return;

  const analysisId = String(formData.get("analysisId") ?? "").trim();
  if (!analysisId) return;

  const client = createPipelineClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("analyses")
    .update({
      status: "queued",
      stage: null,
      stage_message: null,
      stage_updated_at: now,
      error: null,
      completed_at: null,
    })
    .eq("id", analysisId)
    .eq("organization_id", orgId)
    .or(`status.eq.failed,and(status.in.(queued,running),stage_updated_at.lt.${now})`)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Could not claim analysis retry: ${error.message}`);
  if (!data) return;

  after(() => runAnalysis(analysisId).catch((runError: unknown) => console.error("Analysis retry failed:", runError)));
}
