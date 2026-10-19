"use client";

import Link from "next/link";
import { useState } from "react";
import { isStale, type StagePayload } from "@/lib/analysis-stage";
import { formatRelativeTime } from "@/lib/relative-time";
import { useAnalysisStage } from "@/lib/use-analysis-stage";

export type AnalysisRowData = {
  id: string;
  status: string;
  stage: string | null;
  stage_message: string | null;
  stage_updated_at: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  commit_sha: string | null;
  project: { name: string } | null;
};

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

function AnalysisRow({ initial }: { initial: AnalysisRowData }) {
  const [live, setLive] = useState<StagePayload | null>(null);
  const status = live?.status ?? initial.status;
  const stage = live ? live.stage : initial.stage;
  const message = live ? live.message : initial.stage_message;
  const error = live ? live.error : initial.error;
  const updatedAt = live?.updated_at ?? initial.stage_updated_at;

  const unfinished = status === "queued" || status === "running";
  const notice = useAnalysisStage(initial.id, unfinished, setLive);
  // Staleness is a property of when you look, not a timer — "now" is captured
  // once at mount, not ticked.
  const [now] = useState(() => Date.now());
  const stale = isStale(status, updatedAt, now);

  return (
    <Link
      className="grid grid-cols-[minmax(14rem,1fr)_9rem_8rem_10rem_10rem] items-center gap-4 border-b border-zinc-100 px-4 py-4 last:border-b-0 hover:bg-zinc-50/80 dark:border-zinc-900 dark:hover:bg-zinc-900/40"
      href={`/workspace/analyses/${initial.id}`}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium text-foreground">
          {initial.project?.name ?? "Unnamed repository"}
        </p>
        <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">
          {initial.id}
        </p>
      </div>
      <div className="min-w-0">
        {stale ? (
          <>
            <span className="w-fit rounded-full border border-zinc-300 bg-zinc-100 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Stale
            </span>
            <p className="mt-1 truncate font-mono text-[10px] text-zinc-400">
              no progress since {formatRelativeTime(updatedAt)}
            </p>
          </>
        ) : (
          <>
            <span
              className={`w-fit rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${statusStyle(status)}`}
            >
              {statusLabel(status)}
            </span>
            {status === "running" && stage ? (
              <p className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={message ?? undefined}>
                {stage}{message ? ` — ${message}` : ""}
              </p>
            ) : null}
            {status === "failed" ? (
              <p className="mt-1 truncate font-mono text-[10px] text-rose-600 dark:text-rose-400" title={error ?? undefined}>
                {stage ? `${stage}: ` : ""}{error ?? "failed"}
              </p>
            ) : null}
            {notice ? <p className="mt-1 truncate font-mono text-[10px] text-zinc-400">{notice}</p> : null}
          </>
        )}
      </div>
      <span className="font-mono text-xs text-zinc-500">
        {initial.commit_sha ?? "—"}
      </span>
      <time
        className="font-mono text-xs text-zinc-500"
        dateTime={initial.created_at}
      >
        {formatRelativeTime(initial.created_at)}
      </time>
      <time
        className="font-mono text-xs text-zinc-500"
        dateTime={initial.completed_at ?? undefined}
      >
        {formatRelativeTime(initial.completed_at)}
      </time>
    </Link>
  );
}

export function AnalysisRows({ analyses }: { analyses: AnalysisRowData[] }) {
  return (
    <>
      {analyses.map((analysis) => (
        <AnalysisRow initial={analysis} key={analysis.id} />
      ))}
    </>
  );
}
