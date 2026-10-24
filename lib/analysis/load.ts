import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileMetrics } from "../graph.ts";
import type { Coverage, Edge, EdgeKind, FileRecord, FileRole, ParseResult, Route, RouteMethod } from "../parser/types.ts";
import { FILE_ROLES, isModelRole, ROUTE_METHODS, type ModelRole } from "../roles.ts";
import type { StagePayload } from "../analysis-stage.ts";

export type AnalysisRow = {
  id: string;
  status: StagePayload["status"];
  stage: StagePayload["stage"];
  stage_message: string | null;
  error: string | null;
  stage_updated_at: string;
  commit_sha: string | null;
  adapter: string | null;
  summary: ParseResult["summary"] | null;
  coverage: Coverage | null;
  skipped: ParseResult["skipped"] | null;
  project: { name: string; repository_url: string; default_branch: string | null } | null;
};

type FileRow = {
  id: string;
  path: string;
  directory: string;
  module: string;
  extension: string;
  lines: number;
  sha256: string;
  role: string | null;
};

type EdgeRow = {
  source_file_id: string;
  target_file_id: string;
  import_kind: string;
};

type RouteRow = {
  file_id: string;
  method: string;
  path: string;
};

type FileRoleRow = {
  file_id: string;
  role: string;
};

const EDGE_KINDS: readonly string[] = ["import", "re-export", "dynamic-import", "require"];
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFileRole(role: string): role is FileRole {
  return FILE_ROLES.some((known) => known === role);
}

function isRouteMethod(method: string): method is RouteMethod {
  return ROUTE_METHODS.some((known) => known === method);
}

function isEdgeKind(kind: string): kind is EdgeKind {
  return EDGE_KINDS.includes(kind);
}

// PostgREST caps responses at 1000 rows — a single read silently truncates
// big repositories, so every table is paged.
async function paged<Row>(read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

export async function loadAnalysis(supabase: SupabaseClient, id: string): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, stage, stage_message, error, stage_updated_at, commit_sha, adapter, summary, coverage, skipped, project:projects(name, repository_url, default_branch)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load analysis: ${error.message}`);
  // supabase-js types a many-to-one embed as an array; at runtime it's an
  // object, so the boundary cast goes through unknown.
  return (data as unknown as AnalysisRow | null) ?? null;
}

export async function loadResult(supabase: SupabaseClient, analysis: AnalysisRow): Promise<{ result: ParseResult; modelRoles: Record<string, ModelRole> }> {
  if (
    analysis.coverage === null ||
    analysis.summary === null ||
    analysis.skipped === null ||
    analysis.adapter === null ||
    analysis.project === null
  ) {
    throw new Error(`Stored analysis ${analysis.id} is incomplete`);
  }

  const fileRows = await paged<FileRow>(
    (from, to) =>
      supabase
        .from("files")
        .select("id, path, directory, module, extension, lines, sha256, role")
        .eq("analysis_id", analysis.id)
        .order("path")
        .range(from, to),
    "files",
  );

  const edgeRows = await paged<EdgeRow>(
    (from, to) =>
      supabase
        .from("edges")
        .select("source_file_id, target_file_id, import_kind")
        .eq("analysis_id", analysis.id)
        .order("id")
        .range(from, to),
    "edges",
  );

  const routeRows = await paged<RouteRow>(
    (from, to) =>
      supabase
        .from("routes")
        .select("file_id, method, path")
        .eq("analysis_id", analysis.id)
        .order("id")
        .range(from, to),
    "routes",
  );

  const roleRows = await paged<FileRoleRow>(
    (from, to) =>
      supabase
        .from("file_roles")
        .select("file_id, role")
        .eq("analysis_id", analysis.id)
        .order("file_id")
        .range(from, to),
    "file roles",
  );

  const files: FileRecord[] = fileRows.map((row) => {
    if (row.role !== null && !isFileRole(row.role)) {
      throw new Error(`Unknown file role stored: ${row.role}`);
    }
    return {
      path: row.path,
      directory: row.directory,
      module: row.module,
      extension: row.extension,
      lines: row.lines,
      sha256: row.sha256,
      role: row.role,
    };
  });

  const pathByFileId = new Map(fileRows.map((row) => [row.id, row.path]));

  const modelRoles: Record<string, ModelRole> = {};
  for (const row of roleRows) {
    const filePath = pathByFileId.get(row.file_id);
    if (!filePath) throw new Error(`Stored file role references a file that was not stored: ${row.file_id}`);
    if (!isModelRole(row.role)) throw new Error(`Unknown model role stored: ${row.role}`);
    modelRoles[filePath] = row.role;
  }

  const edges: Edge[] = edgeRows.map((row) => {
    const from = pathByFileId.get(row.source_file_id);
    const to = pathByFileId.get(row.target_file_id);
    if (!from || !to) throw new Error(`Stored edge references a file that was not stored: ${row.source_file_id} -> ${row.target_file_id}`);
    if (!isEdgeKind(row.import_kind)) throw new Error(`Unknown import kind stored: ${row.import_kind}`);
    return { from, to, kind: row.import_kind };
  });

  const routes: Route[] = routeRows
    .map((row) => {
      const file = pathByFileId.get(row.file_id);
      if (!file) throw new Error(`Stored route references a file that was not stored: ${row.file_id}`);
      if (!isRouteMethod(row.method)) throw new Error(`Unknown route method stored: ${row.method}`);
      return { file, method: row.method, path: row.path };
    })
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.file.localeCompare(right.file));

  return {
    result: {
      root: analysis.project.name,
      adapter: analysis.adapter,
      files,
      edges,
      routes,
      metrics: fileMetrics(files, edges),
      coverage: analysis.coverage,
      skipped: analysis.skipped,
      summary: analysis.summary,
    },
    modelRoles,
  };
}
