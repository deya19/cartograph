"use client";

import { useMemo, useState, type ReactNode } from "react";
import { fileCategories, fileCategory, explainTargetKey, type ExplanationState, type ExplainTarget, type Hover, type Selection, type Staleness } from "./file-category";
import { ExplanationText } from "./explanation-text";
import { AskPanel, type AskConversation } from "./ask-panel";
import { reanalyzeRepository } from "../../actions";
import type { TracingStatus } from "@/lib/ai/client";
import type { ModelRole } from "@/lib/roles";
import {
  buildAdjacency,
  fileNeighbours,
  insights,
  INSIGHT_SENTENCES,
  repositorySummary,
  transitiveWalk,
  type Adjacency,
  type GraphGroup,
  type Insights,
  type Neighbour,
} from "@/lib/graph";
import type { ParseResult } from "@/lib/parser/types";
import { categoriesFor, reachedRoles } from "@/lib/roles";

export type DetailsTab = "structure" | "explanation";
export type PaneMode = "overview" | "ask";

type DetailPaneProps = {
  result: ParseResult;
  groups: GraphGroup[];
  selection: Selection;
  hover: Hover;
  tab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
  onRevealGroup: (group: GraphGroup) => void;
  insightsOpen: boolean;
  onToggleInsights: () => void;
  analysisId: string;
  modelRoles: Record<string, ModelRole>;
  explanations: ReadonlyMap<string, ExplanationState>;
  onExplain: (target: ExplainTarget) => void;
  tracing: TracingStatus;
  mode: PaneMode;
  onModeChange: (mode: PaneMode) => void;
  ask: AskConversation;
};

function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={title}>
      <span className="font-mono text-[10px] text-(--text-muted)">{label}</span>
      <span className="min-w-0 truncate font-mono text-[10px] text-(--text)">{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-(--text-faint) first:mt-0">{children}</p>;
}

function PathRow({
  path,
  trailing,
  highlighted,
  onHover,
  onRevealFile,
}: {
  path: string;
  trailing?: ReactNode;
  highlighted: boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-1 py-0.5 text-left font-mono text-[10px] leading-4 text-(--text) hover:bg-(--row-hover) ${highlighted ? "ring-1 ring-inset ring-(--select)" : ""}`}
      type="button"
      title={path}
      onClick={() => onRevealFile(path)}
      onMouseEnter={() => onHover({ kind: "file", path })}
      onMouseLeave={() => onHover(null)}
    >
      <span className="min-w-0 truncate">{path}</span>
      {trailing !== undefined ? <span className="ml-auto shrink-0 text-(--text-faint)">{trailing}</span> : null}
    </button>
  );
}

function neighbourTags(neighbour: Neighbour): string | undefined {
  const extra = neighbour.kinds.filter((kind) => kind !== "import");
  return extra.length > 0 ? extra.join(" · ") : undefined;
}

function NeighbourList({ neighbours, empty, highlighted, onHover, onRevealFile }: {
  neighbours: Neighbour[];
  empty: ReactNode;
  highlighted: (path: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
}) {
  if (neighbours.length === 0) {
    return <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">{empty}</p>;
  }
  return (
    <div>
      {neighbours.map((neighbour) => (
        <PathRow
          key={neighbour.path}
          highlighted={highlighted(neighbour.path)}
          onHover={onHover}
          onRevealFile={onRevealFile}
          path={neighbour.path}
          trailing={neighbourTags(neighbour)}
        />
      ))}
    </div>
  );
}

function basename(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

function InsightsPanel({ data, highlighted, onHover, onRevealFile }: {
  data: Insights;
  highlighted: (path: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
}) {
  return (
    <div className="mt-1">
      <SectionHeading>Unimported · {data.unimported.length}</SectionHeading>
      <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">{INSIGHT_SENTENCES.unimported}</p>
      {data.unimported.map((path) => (
        <PathRow key={path} highlighted={highlighted(path)} onHover={onHover} onRevealFile={onRevealFile} path={path} />
      ))}
      <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">
        {data.unimportedReached} files reached by the framework, config or test runner not listed
      </p>

      <SectionHeading>Heavily imported · {data.heavilyImported.length}</SectionHeading>
      <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">{INSIGHT_SENTENCES.heavilyImported}</p>
      {data.heavilyImported.map((entry) => (
        <PathRow
          key={entry.path}
          highlighted={highlighted(entry.path)}
          onHover={onHover}
          onRevealFile={onRevealFile}
          path={entry.path}
          trailing={entry.importers}
        />
      ))}

      <SectionHeading>Import cycles · {data.cycles.length}</SectionHeading>
      <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">{INSIGHT_SENTENCES.cycles}</p>
      {data.cycles.map((cycle, index) => (
        <div className="mt-1" key={cycle.files.join("\0")}>
          {cycle.files.map((path, fileIndex) => (
            <div key={path}>
              {fileIndex > 0 ? <p className="px-1 font-mono text-[10px] leading-3 text-(--text-faint)">→</p> : null}
              <PathRow highlighted={highlighted(path)} onHover={onHover} onRevealFile={onRevealFile} path={path} />
            </div>
          ))}
          {cycle.groupSize > cycle.files.length ? (
            <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">loop group of {cycle.groupSize} files</p>
          ) : null}
          {index < data.cycles.length - 1 ? <div className="my-1 border-t border-(--node-divider)" /> : null}
        </div>
      ))}

      <SectionHeading>Long files · {data.long.length}</SectionHeading>
      <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">{INSIGHT_SENTENCES.long}</p>
      {data.long.map((entry) => (
        <PathRow
          key={entry.path}
          highlighted={highlighted(entry.path)}
          onHover={onHover}
          onRevealFile={onRevealFile}
          path={entry.path}
          trailing={entry.lines}
        />
      ))}
    </div>
  );
}

function RepositorySummary({ result, modelRoles, highlighted, onHover, onRevealFile, insightsOpen, onToggleInsights }: {
  result: ParseResult;
  modelRoles: Record<string, ModelRole>;
  highlighted: (path: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
  insightsOpen: boolean;
  onToggleInsights: () => void;
}) {
  const summary = useMemo(() => repositorySummary(result.files, result.edges), [result.files, result.edges]);
  const insightData = useMemo(() => insights(result.files, result.edges, reachedRoles(result.adapter)), [result.files, result.edges, result.adapter]);
  const moreUnimported = summary.unimportedTotal - summary.unimported.length;
  // Files no convention recognised — the rest are reached by the framework,
  // a config loader or a test runner rather than by an import.
  const unidentified = result.files.filter((file) => file.role === null).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <SectionHeading>Repository</SectionHeading>
      <div className="mt-1">
        <Stat label="Name" value={basename(result.root)} title={result.root} />
        <Stat label="Framework" value={result.adapter === "fallback" ? "none (fallback adapter)" : result.adapter} />
        <Stat label="Files" value={result.files.length} />
        <Stat label="Imports" value={`${result.coverage.resolved} resolved / ${result.coverage.total} found`} />
        <Stat label="Routes" value={result.routes.length} />
        <Stat label="Unidentified" value={unidentified} />
        <Stat label="Labelled by model" value={Object.keys(modelRoles).length} />
      </div>

      <SectionHeading>Routes · {result.routes.length}</SectionHeading>
      <div className="mt-1">
        {result.routes.length === 0 ? (
          <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">
            {result.adapter === "fallback" ? "no framework adapter matched" : "none"}
          </p>
        ) : (
          result.routes.map((route) => (
            <button
              className={`flex w-full items-baseline gap-2 px-1 py-0.5 text-left font-mono text-[10px] leading-4 text-(--text) hover:bg-(--row-hover) ${highlighted(route.file) ? "ring-1 ring-inset ring-(--select)" : ""}`}
              key={`${route.method}${route.path}${route.file}`}
              title={route.file}
              type="button"
              onClick={() => onRevealFile(route.file)}
              onMouseEnter={() => onHover({ kind: "file", path: route.file })}
              onMouseLeave={() => onHover(null)}
            >
              <span className="w-14 shrink-0 text-(--text-faint)">{route.method}</span>
              <span className="min-w-0 break-all">{route.path}</span>
            </button>
          ))
        )}
      </div>

      <SectionHeading>Most imported</SectionHeading>
      <div className="mt-1">
        {summary.mostImported.map((entry) => (
          <PathRow
            key={entry.path}
            highlighted={highlighted(entry.path)}
            onHover={onHover}
            onRevealFile={onRevealFile}
            path={entry.path}
            trailing={entry.importers}
          />
        ))}
      </div>

      <SectionHeading>Nothing imports these · {summary.unimportedTotal}</SectionHeading>
      <div className="mt-1">
        {summary.unimported.map((entry) => (
          <PathRow
            key={entry.path}
            highlighted={highlighted(entry.path)}
            onHover={onHover}
            onRevealFile={onRevealFile}
            path={entry.path}
            trailing={`${entry.imports} imports`}
          />
        ))}
        {moreUnimported > 0 ? (
          <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">+{moreUnimported} more</p>
        ) : null}
      </div>

      <button
        className="mt-4 flex w-full items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-(--text-faint) hover:text-(--text-muted)"
        type="button"
        onClick={onToggleInsights}
      >
        <span>Insights</span>
        <span>{insightsOpen ? "hide" : "show"}</span>
      </button>
      {insightsOpen ? (
        <InsightsPanel data={insightData} highlighted={highlighted} onHover={onHover} onRevealFile={onRevealFile} />
      ) : null}
    </div>
  );
}

function WalkResults({ adjacency, path, direction, highlighted, onHover, onRevealFile }: {
  adjacency: Adjacency;
  path: string;
  direction: "dependents" | "dependencies";
  highlighted: (file: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (file: string) => void;
}) {
  const results = transitiveWalk(adjacency, path, direction);
  const depths = [...new Set(results.map((entry) => entry.depth))].sort();
  return (
    <div className="mt-1">
      <SectionHeading>
        {direction === "dependents" ? "Blast radius" : "Dependency chain"} · {results.length}
      </SectionHeading>
      {results.length === 0 ? (
        <p className="px-1 py-0.5 font-mono text-[10px] leading-4 text-(--text-faint)">none</p>
      ) : (
        depths.map((depth) => (
          <div key={depth}>
            <p className="px-1 pt-1 font-mono text-[10px] leading-4 text-(--text-faint)">
              {depth} step{depth === 1 ? "" : "s"}
            </p>
            {results
              .filter((entry) => entry.depth === depth)
              .map((entry) => (
                <PathRow
                  key={entry.path}
                  highlighted={highlighted(entry.path)}
                  onHover={onHover}
                  onRevealFile={onRevealFile}
                  path={entry.path}
                />
              ))}
          </div>
        ))
      )}
    </div>
  );
}

function FileStructure({ path, result, groups, adjacency, modelRoles, highlighted, onHover, onRevealFile }: {
  path: string;
  result: ParseResult;
  groups: GraphGroup[];
  adjacency: Adjacency;
  modelRoles: Record<string, ModelRole>;
  highlighted: (file: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (file: string) => void;
}) {
  const file = result.files.find((entry) => entry.path === path);
  const group = groups.find((entry) => entry.files.includes(path));
  const neighbours = useMemo(() => fileNeighbours(path, result.edges), [path, result.edges]);
  const [walk, setWalk] = useState<"dependents" | "dependencies" | null>(null);
  if (!file) return null;

  const category = fileCategory(file.extension);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <p className="break-all font-mono text-[10px] leading-4 text-(--text-strong)">{file.path}</p>
      <div className="mt-1">
        <div className="flex items-baseline justify-between gap-2 py-0.5">
          <span className="font-mono text-[10px] text-(--text-muted)">Kind</span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-(--text)">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
            {category.name}
          </span>
        </div>
        <Stat label="Lines" value={file.lines} />
        <Stat label="Folder" value={group?.label ?? "—"} title={group?.path} />
        <Stat
          label="Role"
          value={
            categoriesFor(result.adapter).find((category) => category.role === file.role)?.label ??
            (modelRoles[path] !== undefined ? (
              <>
                {modelRoles[path]} <span className="text-(--text-faint)">· model</span>
              </>
            ) : (
              "—"
            ))
          }
        />
      </div>

      <div className="mt-2 flex gap-1">
        {(
          [
            ["dependents", "Blast radius"],
            ["dependencies", "Dependency chain"],
          ] as const
        ).map(([direction, label]) => (
          <button
            className={`px-1.5 py-0.5 font-mono text-[10px] leading-4 ${walk === direction ? "bg-(--row-hover) text-(--text-strong) shadow-[inset_2px_0_0_var(--select)]" : "text-(--text-muted) hover:bg-(--row-hover)"}`}
            key={direction}
            type="button"
            onClick={() => setWalk((current) => (current === direction ? null : direction))}
          >
            {label}
          </button>
        ))}
      </div>
      {walk !== null ? (
        <WalkResults
          adjacency={adjacency}
          direction={walk}
          highlighted={highlighted}
          onHover={onHover}
          onRevealFile={onRevealFile}
          path={path}
        />
      ) : null}

      <SectionHeading>Imports {neighbours.imports.length}</SectionHeading>
      <NeighbourList
        empty="none"
        highlighted={highlighted}
        neighbours={neighbours.imports}
        onHover={onHover}
        onRevealFile={onRevealFile}
      />

      <SectionHeading>Imported by {neighbours.importedBy.length}</SectionHeading>
      <NeighbourList
        empty="none"
        highlighted={highlighted}
        neighbours={neighbours.importedBy}
        onHover={onHover}
        onRevealFile={onRevealFile}
      />
    </div>
  );
}

function ModuleStructure({ group, result }: { group: GraphGroup; result: ParseResult }) {
  const fileByPath = useMemo(() => new Map(result.files.map((file) => [file.path, file])), [result.files]);
  const records = group.files.flatMap((path) => {
    const file = fileByPath.get(path);
    return file ? [file] : [];
  });
  const kinds = fileCategories(records);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <p className="break-all font-mono text-[10px] leading-4 text-(--text-strong)">{group.label}</p>
      <div className="mt-1">
        <Stat label="Path" value={group.path} />
        <Stat label="Files" value={group.files.length} />
        <Stat label="In / out" value={`${group.fanIn} / ${group.fanOut}`} />
      </div>

      <SectionHeading>Kinds inside</SectionHeading>
      <div className="mt-1">
        {kinds.map((kind) => (
          <div className="flex items-center justify-between gap-2 px-1 py-0.5" key={kind.name}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: kind.color }} />
              <span className="truncate font-mono text-[10px] leading-4 text-(--text)">{kind.name}</span>
            </span>
            <span className="font-mono text-[10px] text-(--text-faint)">{kind.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StalenessNotice({ staleness, analysisId }: { staleness: Staleness | null; analysisId: string }) {
  if (staleness === null) {
    return <p className="mt-2 px-1 font-mono text-[10px] leading-4 text-(--text-faint)">Checking for changes…</p>;
  }
  const short = (sha: string) => sha.slice(0, 7);
  if (staleness.state === "unknown") {
    return <p className="mt-2 px-1 font-mono text-[10px] leading-4 text-(--text-faint)">Couldn&apos;t check for changes: {staleness.reason}</p>;
  }
  if (staleness.state === "fresh") return null;

  const notice =
    staleness.state === "file-changed"
      ? `This file changed since commit ${short(staleness.analysed)} was analysed.`
      : staleness.state === "file-removed"
        ? `This file no longer exists at ${short(staleness.head)}.`
        : `The repository has moved past ${short(staleness.analysed)} (now ${short(staleness.head)}).`;

  return (
    <div className="mt-2 flex flex-col gap-1.5 border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
      <p className="font-mono text-[10px] leading-4 text-amber-700 dark:text-amber-300">{notice}</p>
      <form action={reanalyzeRepository}>
        <input name="analysisId" type="hidden" value={analysisId} />
        <button
          className="border border-amber-600/40 px-2 py-0.5 font-mono text-[10px] leading-4 text-amber-800 hover:bg-amber-500/20 dark:border-amber-400/40 dark:text-amber-200"
          type="submit"
        >
          Re-analyse
        </button>
      </form>
    </div>
  );
}

function ExplanationPane({ target, state, filePaths, groupByPath, onExplain, onRevealFile, onRevealGroup, analysisId, tracing }: {
  target: ExplainTarget;
  state: ExplanationState | undefined;
  filePaths: ReadonlySet<string>;
  groupByPath: ReadonlyMap<string, GraphGroup>;
  onExplain: (target: ExplainTarget) => void;
  onRevealFile: (path: string) => void;
  onRevealGroup: (group: GraphGroup) => void;
  analysisId: string;
  tracing: TracingStatus;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
      <div>
        <button
          className="border border-zinc-300 px-2 py-0.5 font-mono text-[10px] leading-4 text-zinc-700 enabled:hover:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:enabled:hover:bg-zinc-800"
          disabled={state?.state === "loading"}
          type="button"
          onClick={() => onExplain(target)}
        >
          {state?.state === "loading" ? "Explaining…" : "Explain"}
        </button>
      </div>
      {state === undefined ? (
        <p className="mt-2 px-1 font-mono text-[10px] leading-4 text-(--text-faint)">No explanation yet.</p>
      ) : state.state === "error" ? (
        <p className="mt-2 px-1 font-mono text-[10px] leading-4 text-rose-600 dark:text-rose-400">{state.message}</p>
      ) : state.state === "done" ? (
        <div className="mt-2">
          <ExplanationText
            filePaths={filePaths}
            groupByPath={groupByPath}
            onRevealFile={onRevealFile}
            onRevealGroup={onRevealGroup}
            text={state.text}
          />
          {state.cached ? <p className="mt-2 px-1 font-mono text-[10px] leading-4 text-(--text-faint)">cached</p> : null}
          <StalenessNotice analysisId={analysisId} staleness={state.staleness} />
        </div>
      ) : null}
      <p className="mt-auto px-1 pt-3 font-mono text-[10px] leading-4 text-(--text-faint)">
        {tracing.enabled ? `traced · LangSmith project ${tracing.project}` : `tracing off: ${tracing.reason} — calls are not recorded`}
      </p>
    </div>
  );
}

export function DetailPane({ result, groups, selection, hover, tab, onTabChange, onHover, onRevealFile, onRevealGroup, insightsOpen, onToggleInsights, analysisId, modelRoles, explanations, onExplain, tracing, mode, onModeChange, ask }: DetailPaneProps) {
  // The walk only reads edges, so one adjacency build makes every click
  // synchronous — no spinner, no fetch.
  const adjacency = useMemo(() => buildAdjacency(result.edges), [result.edges]);
  const filePaths = useMemo(() => new Set(result.files.map((file) => file.path)), [result.files]);
  const groupByPath = useMemo(() => new Map(groups.map((group) => [group.path, group])), [groups]);
  const highlighted = (path: string) =>
    (hover?.kind === "file" && hover.path === path) ||
    (hover?.kind === "module" && groups.find((group) => group.id === hover.id)?.files.includes(path) === true);

  const selectedGroup = selection?.kind === "module" ? groups.find((group) => group.id === selection.id) : undefined;

  return (
    <aside className="flex min-h-0 flex-col border-l border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/20">
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        {(["overview", "ask"] as const).map((name) => (
          <button
            className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] ${mode === name ? "text-(--text-strong) shadow-[inset_0_-1px_0_var(--select)]" : "text-(--text-faint)"}`}
            key={name}
            type="button"
            onClick={() => onModeChange(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {mode === "ask" ? (
        <AskPanel
          conversation={ask}
          filePaths={filePaths}
          groupByPath={groupByPath}
          onRevealFile={onRevealFile}
          onRevealGroup={onRevealGroup}
          selectedPath={selection?.kind === "file" ? selection.path : null}
        />
      ) : selection === null ? (
        <>
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Details</p>
          </div>
          <RepositorySummary
            highlighted={highlighted}
            insightsOpen={insightsOpen}
            modelRoles={modelRoles}
            onHover={onHover}
            onRevealFile={onRevealFile}
            onToggleInsights={onToggleInsights}
            result={result}
          />
        </>
      ) : (
        <>
          <div className="flex border-b border-zinc-200 dark:border-zinc-800">
            {(["structure", "explanation"] as const).map((name) => (
              <button
                className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] ${tab === name ? "text-(--text-strong) shadow-[inset_0_-1px_0_var(--select)]" : "text-(--text-faint)"}`}
                key={name}
                type="button"
                onClick={() => onTabChange(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "explanation" ? (
            <ExplanationPane
              analysisId={analysisId}
              filePaths={filePaths}
              groupByPath={groupByPath}
              onExplain={onExplain}
              onRevealFile={onRevealFile}
              onRevealGroup={onRevealGroup}
              state={explanations.get(explainTargetKey(selection.kind === "file" ? { kind: "file", path: selection.path } : { kind: "module", id: selection.id }))}
              target={selection.kind === "file" ? { kind: "file", path: selection.path } : { kind: "module", id: selection.id }}
              tracing={tracing}
            />
          ) : selection.kind === "file" ? (
            // Keyed on path so the active walk resets with the selected file.
            <FileStructure
              adjacency={adjacency}
              groups={groups}
              key={selection.path}
              highlighted={highlighted}
              modelRoles={modelRoles}
              onHover={onHover}
              onRevealFile={onRevealFile}
              path={selection.path}
              result={result}
            />
          ) : selectedGroup ? (
            <ModuleStructure group={selectedGroup} result={result} />
          ) : null}
        </>
      )}
    </aside>
  );
}
