"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { isStale, stages, type Stage, type StagePayload } from "@/lib/analysis-stage";
import { formatRelativeTime } from "@/lib/relative-time";
import { useAnalysisStage } from "@/lib/use-analysis-stage";

export type AnalysisProgressProps = {
  analysisId: string;
  repositoryName: string;
  commitSha: string | null;
  initial: StagePayload;
};

type View = {
  live: StagePayload;
  // Last message seen per stage this session, so finished stages keep e.g.
  // "Downloaded vercel/ms at 4ff48ce" instead of blanking out.
  messages: Partial<Record<Stage, string>>;
};

function marker(kind: "done" | "current" | "pending" | "failed"): { glyph: string; className: string } {
  switch (kind) {
    case "done":
      return { glyph: "✓", className: "text-emerald-600 dark:text-emerald-400" };
    case "current":
      return { glyph: "→", className: "text-blue-600 dark:text-blue-400" };
    case "failed":
      return { glyph: "✗", className: "text-rose-600 dark:text-rose-400" };
    default:
      return { glyph: "·", className: "text-zinc-400" };
  }
}

export function AnalysisProgress({ analysisId, repositoryName, commitSha, initial }: AnalysisProgressProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(() => ({
    live: initial,
    messages: initial.stage && initial.message ? { [initial.stage]: initial.message } : {},
  }));
  const refreshed = useRef(false);

  const unfinished = view.live.status === "queued" || view.live.status === "running";
  const notice = useAnalysisStage(analysisId, unfinished, (payload) => {
    setView((previous) => ({
      live: payload,
      messages:
        payload.stage && payload.message
          ? { ...previous.messages, [payload.stage]: payload.message }
          : previous.messages,
    }));
    if (payload.status === "complete" && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  });

  const live = view.live;
  const currentIndex = live.stage ? stages.indexOf(live.stage) : -1;
  // Staleness is a property of when you look, not a timer — "now" is captured
  // once at mount, not ticked.
  const [now] = useState(() => Date.now());
  const stale = isStale(live.status, live.updated_at, now);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
          Analysis
        </p>
        <h1 className="font-mono text-xl font-semibold tracking-tight sm:text-2xl">
          {repositoryName}
        </h1>
        {commitSha ? (
          <p className="font-mono text-xs text-zinc-500">
            commit {commitSha.slice(0, 7)}
          </p>
        ) : null}
      </header>

      <ol className="flex flex-col gap-1">
        {stages.map((stage, index) => {
          const kind =
            live.status === "failed" && index === currentIndex
              ? "failed"
              : index < currentIndex || live.status === "complete"
                ? "done"
                : index === currentIndex && live.status === "running"
                  ? "current"
                  : "pending";
          const { glyph, className } = marker(kind);
          const text = view.messages[stage] ?? (kind === "current" ? live.message : null);
          return (
            <li className="flex items-baseline gap-3 py-1.5" key={stage}>
              <span aria-hidden className={`w-4 text-center font-mono text-sm ${className}`}>
                {glyph}
              </span>
              <span className={`font-mono text-sm ${kind === "pending" ? "text-zinc-400" : "text-foreground"}`}>
                {stage}
              </span>
              {text ? (
                <span className="truncate font-mono text-xs text-zinc-500" title={text}>
                  {text}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {live.status === "queued" ? (
        <p className="font-mono text-xs text-zinc-500">Queued, waiting for the run to start.</p>
      ) : null}

      {live.status === "failed" && live.error ? (
        <p className="border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-sm text-rose-700 dark:text-rose-300">
          {live.error}
        </p>
      ) : null}

      {stale ? (
        <p className="font-mono text-xs text-zinc-500">
          No progress since {formatRelativeTime(live.updated_at)}. This run may have stopped.
        </p>
      ) : null}

      {notice ? <p className="font-mono text-xs text-zinc-500">{notice}</p> : null}
    </div>
  );
}
