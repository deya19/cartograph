import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";


type Analysis = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  commit_sha: string | null;
  project: { name: string }[];
};

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(status: string): string {
  return {
    queued: "Queued",
    running: "Running",
    complete: "Complete",
    failed: "Failed",
  }[status] ?? status;
}

function statusStyle(status: string): string {
  return {
    queued:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    running:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    complete:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    failed:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  }[status] ?? "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export default async function WorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, status, created_at, completed_at, commit_sha, project:projects(name)")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load analyses: ${error.message}`);
  }

  const rows = (analyses ?? []) as Analysis[];
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
          <div className="flex items-center gap-5">
            <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              <span className="text-lg font-semibold text-foreground">
                {rows.length}
              </span>{" "}
              {rows.length === 1 ? "analysis" : "analyses"}
            </div>
            <Link
              className="border border-zinc-300 px-3 py-2 font-mono text-[11px] text-zinc-600 hover:border-blue-500 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-blue-400"
              href="/workspace/preview"
            >
              Canvas preview
            </Link>
          </div>
        </header>

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
                {rows.map((analysis) => (
                  <div
                    className="grid grid-cols-[minmax(14rem,1fr)_9rem_8rem_10rem_10rem] items-center gap-4 border-b border-zinc-100 px-4 py-4 last:border-b-0 dark:border-zinc-900"
                    key={analysis.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium text-foreground">
                        {analysis.project[0]?.name ?? "Unnamed repository"}
                      </p>
                      <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">
                        {analysis.id}
                      </p>
                    </div>
                    <span
                      className={`w-fit rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${statusStyle(analysis.status)}`}
                    >
                      {statusLabel(analysis.status)}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      {analysis.commit_sha ?? "—"}
                    </span>
                    <time
                      className="font-mono text-xs text-zinc-500"
                      dateTime={analysis.created_at}
                    >
                      {formatRelativeTime(analysis.created_at)}
                    </time>
                    <time
                      className="font-mono text-xs text-zinc-500"
                      dateTime={analysis.completed_at ?? undefined}
                    >
                      {formatRelativeTime(analysis.completed_at)}
                    </time>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
