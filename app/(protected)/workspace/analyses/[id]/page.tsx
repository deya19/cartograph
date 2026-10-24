import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAnalysis, loadResult, UUID_PATTERN } from "@/lib/analysis/load";
import { tracingStatus } from "@/lib/ai/client";
import { AnalysisProgress } from "./analysis-progress";
import { MapCanvas } from "./map-canvas";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const analysis = await loadAnalysis(supabase, id);

  // notFound() is also what another organization sees — RLS returns no row.
  if (!analysis) notFound();

  if (analysis.status === "complete") {
    const { result, modelRoles } = await loadResult(supabase, analysis);
    return <MapCanvas analysisId={analysis.id} modelRoles={modelRoles} result={result} tracing={tracingStatus()} />;
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
