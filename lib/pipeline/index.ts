import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSelection, selectFiles } from "../parser/index.ts";
import type { Coverage, ParseResult } from "../parser/types.ts";
import type { Stage } from "../analysis-stage.ts";
import { createPipelineClient } from "./client.ts";
import { canonicalUrl, fetchArchive, parseGitHubUrl } from "./github.ts";

export async function startAnalysis(organizationId: string, url: string): Promise<{ analysisId: string; existing: boolean }> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error(`Not a GitHub repository URL: ${url}`);
  const repositoryUrl = canonicalUrl(parsed);
  const client = createPipelineClient();

  const findProject = async () => {
    const { data, error } = await client
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("repository_url", repositoryUrl)
      .maybeSingle();
    if (error) throw new Error(`Failed to look up project: ${error.message}`);
    return data as { id: string } | null;
  };

  let project = await findProject();
  if (!project) {
    const { data, error } = await client
      .from("projects")
      .insert({ organization_id: organizationId, repository_url: repositoryUrl, name: `${parsed.owner}/${parsed.repo}` })
      .select("id")
      .single();
    if (error) {
      // 23505: another run inserted the same project first — take theirs.
      if (error.code !== "23505") throw new Error(`Failed to create project: ${error.message}`);
      project = await findProject();
    } else {
      project = data as { id: string };
    }
  }
  if (!project) throw new Error(`Failed to create or find project for ${repositoryUrl}`);

  const findAnalysis = async () => {
    const { data, error } = await client.from("analyses").select("id").eq("project_id", project.id).maybeSingle();
    if (error) throw new Error(`Failed to look up analysis: ${error.message}`);
    return data as { id: string } | null;
  };

  const existing = await findAnalysis();
  if (existing) return { analysisId: existing.id, existing: true };

  const { data, error } = await client
    .from("analyses")
    .insert({ organization_id: organizationId, project_id: project.id, status: "queued" })
    .select("id")
    .single();
  if (error) {
    if (error.code !== "23505") throw new Error(`Failed to create analysis: ${error.message}`);
    const raced = await findAnalysis();
    if (!raced) throw new Error(`Failed to create or find analysis for ${repositoryUrl}`);
    return { analysisId: raced.id, existing: true };
  }
  return { analysisId: (data as { id: string }).id, existing: false };
}

export async function runAnalysis(analysisId: string, onStage?: (stage: Stage, message: string) => void): Promise<ParseResult> {
  const client = createPipelineClient();

  const { data: analysisData, error: analysisError } = await client
    .from("analyses")
    .select("id, organization_id, project_id, status")
    .eq("id", analysisId)
    .single();
  if (analysisError || !analysisData) throw new Error(`Analysis not found: ${analysisId}`);
  const analysis = analysisData as { id: string; organization_id: string; project_id: string };

  const { data: projectData, error: projectError } = await client
    .from("projects")
    .select("id, repository_url, name, default_branch")
    .eq("id", analysis.project_id)
    .single();
  if (projectError || !projectData) throw new Error(`Project not found for analysis: ${analysisId}`);
  const project = projectData as { id: string; repository_url: string; default_branch: string };

  const parsed = parseGitHubUrl(project.repository_url);
  if (!parsed) throw new Error(`Not a GitHub repository URL: ${project.repository_url}`);

  // Stage is written before the work starts, so a dead process leaves the row
  // pointing at where it died; a second write lands the finished message.
  const mark = async (stage: Stage, message: string) => {
    const { error } = await client
      .from("analyses")
      .update({ status: "running", stage, stage_message: message, stage_updated_at: new Date().toISOString() })
      .eq("id", analysisId);
    if (error) throw new Error(`Failed to update analysis stage: ${error.message}`);
    onStage?.(stage, message);
  };

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cartograph-"));
  try {
    await mark("fetching", `Downloading ${parsed.owner}/${parsed.repo} from GitHub`);
    const fetched = await fetchArchive(parsed.owner, parsed.repo, tempDir);
    const { error: projectUpdateError } = await client
      .from("projects")
      .update({ default_branch: fetched.defaultBranch })
      .eq("id", project.id);
    if (projectUpdateError) throw new Error(`Failed to update project: ${projectUpdateError.message}`);
    const { error: shaError } = await client.from("analyses").update({ commit_sha: fetched.sha }).eq("id", analysisId);
    if (shaError) throw new Error(`Failed to update analysis: ${shaError.message}`);
    await mark("fetching", `Downloaded ${fetched.fullName} at ${fetched.sha.slice(0, 7)}`);

    await mark("selecting", "Selecting files");
    const selection = await selectFiles(tempDir);
    await mark("selecting", `Selected ${selection.entries.length} of ${selection.entries.length + selection.skipped.length} files`);

    await mark("parsing", "Parsing files");
    const result = await parseSelection(selection);
    for (const entry of fetched.notExtracted) {
      result.skipped.push({ path: entry.path, reason: `not extracted from archive: ${entry.type}` });
    }
    result.summary.filesFound += fetched.notExtracted.length;
    result.summary.filesSkipped += fetched.notExtracted.length;
    await mark("parsing", `Parsed ${result.summary.filesParsed} files, ${result.edges.length} edges`);

    await mark("storing", "Storing results");
    // A retry replaces rather than appends; the cascade clears old edges.
    const { error: deleteError } = await client.from("files").delete().eq("analysis_id", analysisId);
    if (deleteError) throw new Error(`Failed to clear previous files: ${deleteError.message}`);

    const fileIds = new Map<string, string>();
    for (let index = 0; index < result.files.length; index += 500) {
      const batch = result.files.slice(index, index + 500).map((file) => ({
        organization_id: analysis.organization_id,
        analysis_id: analysisId,
        path: file.path,
        directory: file.directory,
        module: file.module,
        extension: file.extension,
        lines: file.lines,
        sha256: file.sha256,
        role: file.role,
      }));
      const { data, error } = await client.from("files").insert(batch).select("id, path");
      if (error) throw new Error(`Failed to insert files: ${error.message}`);
      for (const row of (data ?? []) as Array<{ id: string; path: string }>) fileIds.set(row.path, row.id);
    }

    const edgeRows = result.edges.map((edge) => {
      const source = fileIds.get(edge.from);
      const target = fileIds.get(edge.to);
      if (!source || !target) throw new Error(`Stored files missing for edge ${edge.from} -> ${edge.to}`);
      return { organization_id: analysis.organization_id, analysis_id: analysisId, source_file_id: source, target_file_id: target, import_kind: edge.kind };
    });
    for (let index = 0; index < edgeRows.length; index += 1000) {
      const { error } = await client.from("edges").insert(edgeRows.slice(index, index + 1000));
      if (error) throw new Error(`Failed to insert edges: ${error.message}`);
    }

    const done = `Stored ${result.files.length} files and ${edgeRows.length} edges`;
    const { error: completeError } = await client
      .from("analyses")
      .update({
        status: "complete",
        stage_message: done,
        stage_updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        adapter: result.adapter,
        summary: result.summary,
        coverage: result.coverage,
        skipped: result.skipped,
        error: null,
      })
      .eq("id", analysisId);
    if (completeError) throw new Error(`Failed to mark analysis complete: ${completeError.message}`);
    onStage?.("storing", done);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      // supabase-js reports failures in the result, not by throwing.
      const { error: writeError } = await client
        .from("analyses")
        .update({ status: "failed", error: message, stage_updated_at: new Date().toISOString() })
        .eq("id", analysisId);
      if (writeError) {
        console.error(`Failed to record analysis failure: ${writeError.message}`);
        console.error(`Original error: ${message}`);
      }
    } catch (writeError) {
      console.error(`Failed to record analysis failure: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
      console.error(`Original error: ${message}`);
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export type { Coverage, ParseResult };
export { canonicalUrl, fetchArchive, parseGitHubUrl } from "./github.ts";
