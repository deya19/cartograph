"use client";

import { useMemo, type ReactNode } from "react";
import { fileCategories, fileCategory, type Hover, type Selection } from "./file-category";
import { fileNeighbours, repositorySummary, type GraphGroup, type Neighbour } from "@/lib/graph";
import type { ParseResult } from "@/lib/parser/types";

export type DetailsTab = "structure" | "explanation";

type DetailPaneProps = {
  result: ParseResult;
  groups: GraphGroup[];
  selection: Selection;
  hover: Hover;
  tab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
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

function RepositorySummary({ result, highlighted, onHover, onRevealFile }: {
  result: ParseResult;
  highlighted: (path: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (path: string) => void;
}) {
  const summary = useMemo(() => repositorySummary(result.files, result.edges), [result.files, result.edges]);
  const moreUnimported = summary.unimportedTotal - summary.unimported.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <SectionHeading>Repository</SectionHeading>
      <div className="mt-1">
        <Stat label="Name" value={basename(result.root)} title={result.root} />
        <Stat label="Framework" value={result.adapter === "fallback" ? "none (fallback adapter)" : result.adapter} />
        <Stat label="Files" value={result.files.length} />
        <Stat label="Imports" value={`${result.coverage.resolved} resolved / ${result.coverage.total} found`} />
        <Stat label="Routes" title="No adapter recovered routes" value="—" />
        {/* FileRecord carries no convention role yet and the fallback adapter
            identifies none, so every file counts as unidentified. */}
        <Stat label="Unidentified" value={result.files.length} />
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
    </div>
  );
}

function FileStructure({ path, result, groups, highlighted, onHover, onRevealFile }: {
  path: string;
  result: ParseResult;
  groups: GraphGroup[];
  highlighted: (file: string) => boolean;
  onHover: (hover: Hover) => void;
  onRevealFile: (file: string) => void;
}) {
  const file = result.files.find((entry) => entry.path === path);
  const group = groups.find((entry) => entry.files.includes(path));
  const neighbours = useMemo(() => fileNeighbours(path, result.edges), [path, result.edges]);
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
      </div>

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

export function DetailPane({ result, groups, selection, hover, tab, onTabChange, onHover, onRevealFile }: DetailPaneProps) {
  const highlighted = (path: string) =>
    (hover?.kind === "file" && hover.path === path) ||
    (hover?.kind === "module" && groups.find((group) => group.id === hover.id)?.files.includes(path) === true);

  const selectedGroup = selection?.kind === "module" ? groups.find((group) => group.id === selection.id) : undefined;

  return (
    <aside className="flex min-h-0 flex-col border-l border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/20">
      {selection === null ? (
        <>
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Details</p>
          </div>
          <RepositorySummary
            highlighted={highlighted}
            onHover={onHover}
            onRevealFile={onRevealFile}
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
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <p className="px-1 font-mono text-[10px] leading-4 text-(--text-faint)">No explanation yet.</p>
            </div>
          ) : selection.kind === "file" ? (
            <FileStructure
              groups={groups}
              highlighted={highlighted}
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
