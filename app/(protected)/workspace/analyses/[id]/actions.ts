"use server";

import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAnalysis, loadResult, UUID_PATTERN } from "@/lib/analysis/load";
import { explainFile, explainFolder } from "@/lib/ai/explain";
import { flushTraces } from "@/lib/ai/client";
import { fetchHeadSha, fetchRawFile, parseGitHubUrl } from "@/lib/pipeline/github";

export type ExplainTarget = { kind: "file"; path: string } | { kind: "module"; id: string };

export type ExplainResult = { ok: true; text: string; cached: boolean } | { ok: false; error: string };

export type StalenessResult =
  | { state: "fresh" }
  | { state: "repo-moved"; analysed: string; head: string }
  | { state: "file-changed"; analysed: string; head: string }
  | { state: "file-removed"; analysed: string; head: string }
  | { state: "unknown"; reason: string };

// RLS returns no row for another organization's analysis, matching the app's
// usual "not yours" response.
async function loadAnalysisContext(analysisId: string) {
  const { orgId } = await auth();
  if (!orgId || !UUID_PATTERN.test(analysisId)) return null;

  const supabase = await createSupabaseServerClient();
  const analysis = await loadAnalysis(supabase, analysisId);
  if (!analysis || analysis.status !== "complete" || !analysis.commit_sha || !analysis.project) return null;

  const repository = parseGitHubUrl(analysis.project.repository_url);
  if (!repository) return null;

  return {
    client: supabase,
    organizationId: orgId,
    repository,
    commitSha: analysis.commit_sha,
    defaultBranch: analysis.project.default_branch,
    analysis,
  };
}

async function loadContext(analysisId: string) {
  const base = await loadAnalysisContext(analysisId);
  if (!base) return { context: null, result: null, modelRoles: {}, defaultBranch: null };
  const { result, modelRoles } = await loadResult(base.client, base.analysis);
  return {
    context: {
      client: base.client,
      organizationId: base.organizationId,
      repository: base.repository,
      commitSha: base.commitSha,
    },
    result,
    modelRoles,
    defaultBranch: base.defaultBranch,
  };
}

export async function explainTarget(analysisId: string, target: ExplainTarget): Promise<ExplainResult> {
  try {
    const { context, result, modelRoles } = await loadContext(analysisId);
    if (!context || !result) return { ok: false, error: "Analysis is not available." };

    const explanation =
      target.kind === "file"
        ? await explainFile({ ...context, result, modelRoles, path: target.path })
        : await explainFolder({ ...context, result, modelRoles, groupId: target.id });

    return { ok: true, text: explanation.text, cached: explanation.cached };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    after(() => flushTraces());
  }
}

export async function checkStaleness(analysisId: string, target: ExplainTarget): Promise<StalenessResult> {
  try {
    const base = await loadAnalysisContext(analysisId);
    if (!base) return { state: "unknown", reason: "analysis is not available" };
    if (!base.defaultBranch) return { state: "unknown", reason: "the repository's default branch is not recorded" };

    const analysed = base.commitSha;
    const head = await fetchHeadSha(base.repository.owner, base.repository.repo, base.defaultBranch);
    if (head === analysed) return { state: "fresh" };

    if (target.kind === "module") return { state: "repo-moved", analysed, head };

    const { data, error } = await base.client
      .from("files")
      .select("sha256")
      .eq("analysis_id", analysisId)
      .eq("path", target.path)
      .maybeSingle();
    if (error) throw new Error(`Could not load file hash: ${error.message}`);
    const file = data as { sha256: string } | null;
    if (!file) return { state: "unknown", reason: "file is not in this analysis" };

    const { status, text } = await fetchRawFile(base.repository.owner, base.repository.repo, head, target.path);
    if (status === 404) return { state: "file-removed", analysed, head };
    if (text === null) return { state: "unknown", reason: `GitHub returned HTTP ${status} for the current file` };

    const digest = createHash("sha256").update(text).digest("hex");
    return digest === file.sha256 ? { state: "repo-moved", analysed, head } : { state: "file-changed", analysed, head };
  } catch (error) {
    return { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}
