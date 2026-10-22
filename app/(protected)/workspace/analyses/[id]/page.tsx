import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fileMetrics } from "@/lib/graph";
import type { Coverage, Edge, EdgeKind, FileRecord, FileRole, ParseResult, Route, RouteMethod } from "@/lib/parser/types";
import { FILE_ROLES, ROUTE_METHODS } from "@/lib/roles";
import { AnalysisProgress } from "./analysis-progress";
import { MapCanvas } from "./map-canvas";
import type { StagePayload } from "@/lib/analysis-stage";

type AnalysisRow = {
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
  project: { name: string; repository_url: string } | null;
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

const EDGE_KINDS: readonly string[] = ["import", "re-export", "dynamic-import", "require"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFileRole(role: string): role is FileRole {
  return FILE_ROLES.some((known) => known === role);
}

function isRouteMethod(method: string): method is RouteMethod {
  return ROUTE_METHODS.some((known) => known === method);
}

function isEdgeKind(kind: string): kind is EdgeKind {
  return EDGE_KINDS.includes(kind);
}

async function loadResult(supabase: SupabaseClient, analysis: AnalysisRow): Promise<ParseResult> {
  if (
    analysis.coverage === null ||
    analysis.summary === null ||
    analysis.skipped === null ||
    analysis.adapter === null ||
    analysis.project === null
  ) {
    throw new Error(`Stored analysis ${analysis.id} is incomplete`);
  }

  // PostgREST caps responses at 1000 rows — a single read silently truncates
  // big repositories, so both tables are paged.
  const fileRows: FileRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("files")
      .select("id, path, directory, module, extension, lines, sha256, role")
      .eq("analysis_id", analysis.id)
      .order("path")
      .range(from, from + 999);
    if (error) throw new Error(`Could not load files: ${error.message}`);
    const page = (data ?? []) as FileRow[];
    fileRows.push(...page);
    if (page.length < 1000) break;
  }

  const edgeRows: EdgeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("edges")
      .select("source_file_id, target_file_id, import_kind")
      .eq("analysis_id", analysis.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Could not load edges: ${error.message}`);
    const page = (data ?? []) as EdgeRow[];
    edgeRows.push(...page);
    if (page.length < 1000) break;
  }

  const routeRows: RouteRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("routes")
      .select("file_id, method, path")
      .eq("analysis_id", analysis.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Could not load routes: ${error.message}`);
    const page = (data ?? []) as RouteRow[];
    routeRows.push(...page);
    if (page.length < 1000) break;
  }

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
    root: analysis.project.name,
    adapter: analysis.adapter,
    files,
    edges,
    routes,
    metrics: fileMetrics(files, edges),
    coverage: analysis.coverage,
    skipped: analysis.skipped,
    summary: analysis.summary,
  };
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, stage, stage_message, error, stage_updated_at, commit_sha, adapter, summary, coverage, skipped, project:projects(name, repository_url)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load analysis: ${error.message}`);
  // notFound() is also what another organization sees — RLS returns no row.
  if (!data) notFound();
  // supabase-js types a many-to-one embed as an array; at runtime it's an
  // object, so the boundary cast goes through unknown.
  const analysis = data as unknown as AnalysisRow;

  if (analysis.status === "complete") {
    return <MapCanvas result={await loadResult(supabase, analysis)} />;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 lg:py-10">
      <AnalysisProgress
        analysisId={analysis.id}
        commitSha={analysis.commit_sha}
        initial={{
          status: analysis.status,
          stage: analysis.stage,
          message: analysis.stage_message,
          error: analysis.error,
          updated_at: analysis.stage_updated_at,
        }}
        repositoryName={analysis.project?.name ?? "Unnamed repository"}
      />
    </main>
  );
}
