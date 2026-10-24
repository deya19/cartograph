"use server";

import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAnalysis, loadResult, UUID_PATTERN } from "@/lib/analysis/load";
import { explainFile, explainFolder, type ExplainContext } from "@/lib/ai/explain";
import { flushTraces } from "@/lib/ai/client";
import { fetchHeadSha, fetchRawFile, parseGitHubUrl } from "@/lib/pipeline/github";
import type { ModelRole } from "@/lib/roles";

export type ExplainTarget = { kind: "file"; path: string } | { kind: "module"; id: string };

export type ExplainResult = { ok: true; text: string; cached: boolean } | { ok: false; error: string };

export type StalenessResult =
  | { state: "fresh" }
  | { state: "repo-moved"; analysed: string; head: string }
  | { state: "file-changed"; analysed: string; head: string }
  | { state: "file-removed"; analysed: string; head: string }
  | { state: "unknown"; reason: string };

// Loads the analysis, the stored result and the repository coordinates every
// action needs. RLS returns no row for another organization's analysis, which
// is the same "not yours" answer everywhere else.
async function loadContext(analysisId: string): Promise<{
  context: Omit<ExplainContext, "result" | "modelRoles"> | null;
  result: Awaited<ReturnType<typeof loadResult>>["result"] | null;
  modelRoles: Record<string, ModelRole>;
  defaultBranch: string | null;
}> {
  const { orgId } = await auth();
  if (!orgId || !UUID_PATTERN.test(analysisId)) {
    return { context: null, result: null, modelRoles: {}, defaultBranch: null };
  }

  const supabase = await createSupabaseServerClient();
  const analysis = await loadAnalysis(supabase, analysisId);
  if (!analysis || analysis.status !== "complete" || !analysis.commit_sha || !analysis.project) {
    return { context: null, result: null, modelRoles: {}, defaultBranch: null };
  }

  const repository = parseGitHubUrl(analysis.project.repository_url);
  if (!repository) {
    return { context: null, result: null, modelRoles: {}, defaultBranch: null };
  }

  const { result, modelRoles } = await loadResult(supabase, analysis);
  return {
    context: { client: supabase, organizationId: orgId, repository, commitSha: analysis.commit_sha },
    result,
    modelRoles,
    defaultBranch: analysis.project.default_branch,
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
    const { context, result, defaultBranch } = await loadContext(analysisId);
    if (!context || !result) return { state: "unknown", reason: "analysis is not available" };
    if (!defaultBranch) return { state: "unknown", reason: "the repository's default branch is not recorded" };

    const analysed = context.commitSha;
    const head = await fetchHeadSha(context.repository.owner, context.repository.repo, defaultBranch);
    if (head === analysed) return { state: "fresh" };

    if (target.kind === "module") return { state: "repo-moved", analysed, head };

    const file = result.files.find((entry) => entry.path === target.path);
    if (!file) return { state: "unknown", reason: "file is not in this analysis" };

    const { status, text } = await fetchRawFile(context.repository.owner, context.repository.repo, head, target.path);
    if (status === 404) return { state: "file-removed", analysed, head };
    if (text === null) return { state: "unknown", reason: `GitHub returned HTTP ${status} for the current file` };

    const digest = createHash("sha256").update(text).digest("hex");
    return digest === file.sha256 ? { state: "repo-moved", analysed, head } : { state: "file-changed", analysed, head };
  } catch (error) {
    return { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}
