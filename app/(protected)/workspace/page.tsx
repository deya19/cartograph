import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AnalyzeForm } from "./analyze-form";
import { AnalysisRows, type AnalysisRowData } from "./analysis-rows";

export default async function WorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, status, stage, stage_message, stage_updated_at, error, created_at, completed_at, commit_sha, project:projects(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Could not load analyses: ${error.message}`);
  }

  // supabase-js types a many-to-one embed as an array; at runtime it's an
  // object, so the boundary cast goes through unknown.
  const rows = (analyses ?? []) as unknown as AnalysisRowData[];
  const completedCount = rows.filter(({ status }) => status === "complete").length;
  const activeCount = rows.filter(
    ({ status }) => status === "queued" || status === "running",
  ).length;

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 lg:py-10">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-5 border-b border-zinc-200 pb-7 dark:border-zinc-800 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Workspace
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Repository analyses
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              Every analysis in this workspace, with the state of its map and
              the time it was last processed.
            </p>
          </div>
          <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-lg font-semibold text-foreground">
              {rows.length}
            </span>{" "}
            {rows.length === 1 ? "analysis" : "analyses"}
          </div>
        </header>

        <AnalyzeForm />

        <section aria-label="Analysis summary" className="grid gap-3 sm:grid-cols-3">
          <div className="border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
              Total analyses
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{rows.length}</p>
          </div>
          <div className="border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
              In progress
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-blue-600 dark:text-blue-400">
              {activeCount}
            </p>
          </div>
          <div className="border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
              Completed
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
              {completedCount}
            </p>
          </div>
        </section>

        {rows.length === 0 ? (
          <section className="border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
            <p className="font-mono text-sm text-zinc-500">No analyses yet.</p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Analyses for this organization will appear here when they are run.
            </p>
          </section>
        ) : (
          <section className="overflow-hidden border border-zinc-200 bg-white/40 dark:border-zinc-800 dark:bg-zinc-950/30">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="font-mono text-xs font-medium uppercase tracking-wide text-zinc-500">
                Recent runs
              </h2>
              <span className="font-mono text-[11px] text-zinc-500">
                sorted by created
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[minmax(14rem,1fr)_9rem_8rem_10rem_10rem] gap-4 border-b border-zinc-200 bg-zinc-50/80 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <span>Repository</span>
                  <span>State</span>
                  <span>Commit</span>
                  <span>Started</span>
                  <span>Finished</span>
                </div>
                <AnalysisRows analyses={rows} />
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
