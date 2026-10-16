"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import type { Edge as FlowEdge, Node, NodeProps } from "@xyflow/react";
import { graphlib, layout } from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { ParseResult } from "@/lib/parser/types";
import { useResolvedTheme } from "@/components/use-resolved-theme";
import {
  PANEL_ROWS,
  clampOffset,
  foldModules,
  visibleGraph,
  type GraphGroup,
  type VisibleItem,
} from "@/lib/graph";
import { DetailPane, type DetailsTab } from "./detail-pane";
import { fileCategories, fileCategory, type FileCategory, type Hover, type Selection } from "./file-category";

type PreviewCanvasProps = {
  result: ParseResult;
};

type ModuleNodeData = {
  item: VisibleItem;
  lit: ReadonlySet<string> | null;
  dim: boolean;
  selection: Selection;
  hover: Hover;
  categoryByFile: ReadonlyMap<string, FileCategory>;
  onToggle: (group: GraphGroup, opening: boolean) => void;
  onSelectFile: (path: string) => void;
  onScroll: (group: GraphGroup, delta: number) => void;
  onHover: (hover: Hover) => void;
};

type ModuleFlowNode = Node<ModuleNodeData, "module">;

const PANEL_HEADER_HEIGHT = 44;
const PANEL_ROW_HEIGHT = 22;
const EDGE_COLOR = "var(--edge)";
const OUTGOING_EDGE_COLOR = "var(--edge-out)";
const INCOMING_EDGE_COLOR = "var(--edge-in)";

// SVG marker colours are set as presentation attributes, where var() doesn't
// resolve — so markers and the background dots take theme-resolved hexes.
const THEME_HEX = {
  light: { edge: "#a1a1aa", edgeIn: "#16a34a", edgeOut: "#d97706", canvasDot: "#d4d4d8" },
  dark: { edge: "#52525b", edgeIn: "#22c55e", edgeOut: "#f59e0b", canvasDot: "#27272a" },
} as const;

function foldedWidth(label: string): number {
  return Math.max(120, Math.min(320, 32 + label.length * 7.2));
}

function foldedHeight(fanIn: number, maxFanIn: number): number {
  if (maxFanIn <= 0) return 64;
  return 64 + Math.round(Math.sqrt(fanIn / maxFanIn) * 96);
}

function itemSize(item: VisibleItem, maxFanIn: number): { width: number; height: number } {
  const label = item.group.label;
  if (item.kind === "module") {
    return { width: foldedWidth(label), height: foldedHeight(item.group.fanIn, maxFanIn) };
  }
  // An overflowing panel is a constant height (both cap lines always render)
  // so scrolling never changes the layout.
  return {
    width: Math.max(260, foldedWidth(label)),
    height:
      PANEL_HEADER_HEIGHT +
      item.rows.length * PANEL_ROW_HEIGHT +
      (item.overflows ? 2 * PANEL_ROW_HEIGHT : 0),
  };
}

function layoutNodes(
  items: VisibleItem[],
  edges: { source: string; target: string }[],
  maxFanIn: number,
): Map<string, { x: number; y: number; width: number; height: number }> {
  const graph = new graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 72, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { width: number; height: number }>();
  for (const item of items) {
    const size = itemSize(item, maxFanIn);
    sizes.set(item.id, size);
    graph.setNode(item.id, size);
  }

  // Dagre edges are node-to-node; the per-handle aggregates collapse to one.
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.source}\0${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    graph.setEdge(edge.source, edge.target);
  }

  layout(graph);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const item of items) {
    const size = sizes.get(item.id) ?? { width: 0, height: 0 };
    const node = graph.node(item.id);
    positions.set(item.id, { x: node.x - size.width / 2, y: node.y - size.height / 2, ...size });
  }
  return positions;
}

const handleStyle = { width: 6, height: 6, opacity: 0, border: "none" };

function ModuleNode({ id, data }: NodeProps<ModuleFlowNode>) {
  const { item, lit, dim, selection, hover, categoryByFile, onToggle, onSelectFile, onScroll, onHover } = data;
  const group = item.group;

  // Opening and scrolling swap the handle set without resizing the node, and
  // React Flow only re-measures handles when told to; otherwise edges aimed at
  // the new row handles have nothing to attach to.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSet = item.kind === "panel" ? item.rows[0]?.id ?? "panel" : "module";
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleSet, updateNodeInternals]);
  const opacity = dim ? "opacity-20" : "opacity-100";

  const categoryCounts = new Map<string, { color: string; count: number }>();
  for (const file of group.files) {
    const category = categoryByFile.get(file) ?? { name: "OTHER", color: "var(--kind-other)" };
    const entry = categoryCounts.get(category.name) ?? { color: category.color, count: 0 };
    entry.count += 1;
    categoryCounts.set(category.name, entry);
  }
  const strip = [...categoryCounts.entries()].sort(([left], [right]) => left.localeCompare(right));

  if (item.kind === "module") {
    const hovered =
      (hover?.kind === "module" && hover.id === item.id) ||
      (hover?.kind === "file" && group.files.includes(hover.path));
    return (
      <>
        <AttachmentHandles />
        <button
          className={`relative flex size-full flex-col justify-between overflow-hidden rounded-md border bg-(--node) px-3 py-2 text-left ${hovered ? "border-(--select)" : "border-(--node-border) hover:border-(--node-border-hover)"} ${opacity}`}
          type="button"
          onClick={() => onToggle(group, true)}
          onMouseEnter={() => onHover({ kind: "module", id: item.id })}
          onMouseLeave={() => onHover(null)}
        >
          <span className="block shrink-0 truncate font-mono text-xs font-semibold leading-4 text-(--text-strong)">{group.label}</span>
          <span className="block shrink-0 font-mono text-[10px] leading-[14px] text-(--text-muted)">{group.files.length} files</span>
          <span className="block shrink-0 font-mono text-[10px] leading-[14px] text-(--text)">
            in {group.fanIn} · out {group.fanOut}
          </span>
          <span className="absolute inset-x-0 bottom-0 flex h-[3px]">
            {strip.map(([name, { color, count }]) => (
              <span
                key={name}
                style={{ width: `${(count / group.files.length) * 100}%`, backgroundColor: color }}
                title={`${name} ${count}`}
              />
            ))}
          </span>
        </button>
      </>
    );
  }

  // A dimmed panel already fades as a whole; rows must not dim again on top.
  const rowLit = (file: string) => (!dim && lit !== null && !lit.has(file) ? "opacity-20" : "");
  const lineLit = (files: string[]) => dim || lit === null || files.some((file) => lit.has(file));
  const rowCentre = (index: number) => PANEL_HEADER_HEIGHT + index * PANEL_ROW_HEIGHT + PANEL_ROW_HEIGHT / 2;
  const panelSelected = selection?.kind === "module" && selection.id === item.id;
  // When overflowing, the "above" cap occupies the first line slot.
  const windowShift = item.overflows ? 1 : 0;
  const capClass = (litUp: boolean, count: number) =>
    `h-[22px] w-full px-3 text-left font-mono text-[10px] leading-[22px] hover:bg-(--row-hover) ${count === 0 ? "text-(--text-faint)" : "text-(--text-muted)"} ${litUp ? "opacity-100" : "opacity-20"}`;

  return (
    <>
    {item.overflows ? <AttachmentHandles suffix={`${item.id}::above`} top={rowCentre(0)} /> : null}
    {item.rows.map((row, index) => (
      <AttachmentHandles key={row.id} suffix={row.id} top={rowCentre(index + windowShift)} />
    ))}
    {item.overflows ? <AttachmentHandles suffix={`${item.id}::more`} top={rowCentre(item.rows.length + windowShift)} /> : null}
    <section
      aria-label={`${group.label} module panel`}
      className={`nowheel relative flex size-full flex-col overflow-hidden rounded-md border bg-(--node) ${panelSelected ? "border-(--select)" : "border-(--node-border)"} ${opacity}`}
      onWheel={(event) => {
        if (!item.overflows || event.deltaY === 0) return;
        onScroll(group, Math.sign(event.deltaY));
      }}
    >
      <button
        className="flex h-11 w-full shrink-0 items-center justify-between border-b border-(--node-divider) bg-(--node-header) px-3 text-left hover:bg-(--row-hover)"
        type="button"
        onClick={() => onToggle(group, false)}
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs font-semibold text-(--text-strong)">{group.label}</span>
          <span className="block font-mono text-[10px] text-(--text-muted)">
            {group.files.length} files · in {group.fanIn} · out {group.fanOut}
          </span>
        </span>
        <span className="ml-2 shrink-0 font-mono text-[10px] text-(--text-muted)">close</span>
      </button>
      <div className="divide-y divide-(--node-divider)">
        {item.overflows ? (
          <button
            className={capClass(lineLit(item.above), item.above.length)}
            type="button"
            onClick={() => onScroll(group, -PANEL_ROWS)}
          >
            ↑ {item.above.length} above
          </button>
        ) : null}
        {item.rows.map((row) => {
          const selected = selection?.kind === "file" && selection.path === row.file;
          const hovered = hover?.kind === "file" && hover.path === row.file;
          const color = categoryByFile.get(row.file)?.color ?? "var(--kind-other)";
          return (
            <button
              className={`flex h-[22px] w-full items-center gap-1.5 px-3 text-left font-mono text-[10px] leading-[22px] text-(--text) hover:bg-(--row-hover) ${selected ? "bg-(--row-hover) shadow-[inset_2px_0_0_var(--select)]" : ""} ${hovered ? "ring-1 ring-inset ring-(--select)" : ""} ${rowLit(row.file)}`}
              key={row.id}
              title={row.file}
              type="button"
              onClick={() => onSelectFile(row.file)}
              onMouseEnter={() => onHover({ kind: "file", path: row.file })}
              onMouseLeave={() => onHover(null)}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="truncate">{row.label}</span>
            </button>
          );
        })}
        {item.overflows ? (
          <button
            className={capClass(lineLit(item.hidden), item.hidden.length)}
            type="button"
            onClick={() => onScroll(group, PANEL_ROWS)}
          >
            ↓ {item.hidden.length} more
          </button>
        ) : null}
      </div>
      {item.overflows ? (
        <div
          aria-hidden="true"
          className="absolute right-0 w-0.5 bg-(--node-divider)"
          style={{ top: PANEL_HEADER_HEIGHT + PANEL_ROW_HEIGHT, height: item.rows.length * PANEL_ROW_HEIGHT }}
        >
          <div
            className="absolute right-0 w-0.5 bg-(--text-muted)"
            style={{
              top: `${(item.above.length / group.files.length) * 100}%`,
              height: `${(PANEL_ROWS / group.files.length) * 100}%`,
            }}
          />
        </div>
      ) : null}
    </section>
    </>
  );
}

// Handles render <div>s, which may not sit inside a <button> or <p>, so they
// are siblings of the node body and positioned against the node wrapper.
function AttachmentHandles({ suffix, top }: { suffix?: string; top?: number }) {
  const style = top === undefined ? handleStyle : { ...handleStyle, top };
  return (
    <>
      <Handle className="!min-h-0 !min-w-0" id={suffix ? `in:${suffix}` : "in"} position={Position.Left} style={style} type="target" />
      <Handle className="!min-h-0 !min-w-0" id={suffix ? `out:${suffix}` : "out"} position={Position.Right} style={style} type="source" />
    </>
  );
}

const nodeTypes = { module: ModuleNode };

function MapCanvas({ result, groups, expanded, expandedVersion, selection, hover, categoryByFile, offsets, onToggle, onSelectFile, onScroll, onClearSelection, onHover }: {
  result: ParseResult;
  groups: GraphGroup[];
  categoryByFile: ReadonlyMap<string, FileCategory>;
  expanded: ReadonlySet<string>;
  expandedVersion: number;
  selection: Selection;
  hover: Hover;
  offsets: ReadonlyMap<string, number>;
  onToggle: (group: GraphGroup, opening: boolean) => void;
  onSelectFile: (path: string) => void;
  onScroll: (group: GraphGroup, delta: number) => void;
  onClearSelection: () => void;
  onHover: (hover: Hover) => void;
}) {
  const { fitView, getViewport } = useReactFlow();
  const theme = useResolvedTheme();
  const hex = THEME_HEX[theme];

  const { items, edges } = useMemo(
    () => visibleGraph(groups, result.edges, expanded, offsets),
    [groups, result.edges, expanded, offsets],
  );

  const maxFanIn = useMemo(() => Math.max(0, ...groups.map((group) => group.fanIn)), [groups]);

  const positions = useMemo(() => layoutNodes(items, edges, maxFanIn), [items, edges, maxFanIn]);

  // Selected files plus every file touched by an edge that touches them.
  const highlight = useMemo(() => {
    if (!selection) return null;
    const selected = new Set<string>();
    if (selection.kind === "module") {
      const group = groups.find((entry) => entry.id === selection.id);
      for (const file of group?.files ?? []) selected.add(file);
    } else {
      selected.add(selection.path);
    }
    const litFiles = new Set(selected);
    for (const edge of edges) {
      if (edge.files.some((file) => selected.has(file.from) || selected.has(file.to))) {
        for (const file of edge.files) {
          litFiles.add(file.from);
          litFiles.add(file.to);
        }
      }
    }
    return { selected, lit: litFiles };
  }, [selection, groups, edges]);

  const nodes = useMemo<ModuleFlowNode[]>(
    () =>
      items.map((item) => {
        const position = positions.get(item.id) ?? { x: 0, y: 0, width: 0, height: 0 };
        const dim = highlight !== null && !item.group.files.some((file) => highlight.lit.has(file));
        return {
          id: item.id,
          type: "module" as const,
          position: { x: position.x, y: position.y },
          width: position.width,
          height: position.height,
          // React Flow sets pointer-events: none on nodes that are neither
          // selectable nor draggable, which would swallow every click inside.
          style: { pointerEvents: "all" },
          // Above every edge layer (edges use 0 and 1), so lines pass behind
          // open panels instead of across their rows.
          zIndex: 2,
          data: { item, lit: highlight?.lit ?? null, dim, selection, hover, categoryByFile, onToggle, onSelectFile, onScroll, onHover },
        };
      }),
    [items, positions, highlight, selection, hover, categoryByFile, onToggle, onSelectFile, onScroll, onHover],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const dimmed =
          highlight !== null && !edge.files.some((file) => highlight.selected.has(file.from) || highlight.selected.has(file.to));
        // Direction reads against the selection: green flows into it, amber out
        // of it. Coloured edges paint above the dimmed grey ones.
        const active = highlight !== null && !dimmed;
        const outgoing =
          highlight !== null && edge.files.some((file) => highlight.selected.has(file.from));
        const color = active ? (outgoing ? OUTGOING_EDGE_COLOR : INCOMING_EDGE_COLOR) : EDGE_COLOR;
        const markerColor = active ? (outgoing ? hex.edgeOut : hex.edgeIn) : hex.edge;
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: edge.targetHandle,
          zIndex: active ? 1 : 0,
          style: {
            stroke: color,
            strokeWidth: Math.min(3, 1 + Math.log2(edge.count)),
            opacity: dimmed ? 0.2 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: markerColor },
        };
      }),
    [edges, highlight, hex],
  );

  // Refit only after React Flow holds the post-change nodes; the zoom cap means
  // an open can zoom out but never in.
  useEffect(() => {
    if (expandedVersion === 0) return;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.12, duration: 0, maxZoom: getViewport().zoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [expandedVersion, fitView, getViewport]);

  return (
    <ReactFlow
      colorMode={theme}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      nodes={nodes}
      edges={flowEdges}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={nodeTypes}
      onPaneClick={onClearSelection}
    >
      <Background color={hex.canvasDot} gap={28} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function PreviewCanvas({ result }: PreviewCanvasProps) {
  const groups = useMemo(() => foldModules(result), [result]);
  const categories = useMemo(() => fileCategories(result.files), [result.files]);
  const categoryByFile = useMemo(
    () => new Map(result.files.map((file) => [file.path, fileCategory(file.extension)])),
    [result.files],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("structure");
  const [expandedVersion, setExpandedVersion] = useState(0);
  const [offsets, setOffsets] = useState<ReadonlyMap<string, number>>(new Map());

  const handleToggle = useCallback((group: GraphGroup, opening: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(group.id);
      else next.delete(group.id);
      return next;
    });
    if (!opening) {
      setOffsets((current) => {
        if (!current.has(group.id)) return current;
        const next = new Map(current);
        next.delete(group.id);
        return next;
      });
    }
    setExpandedVersion((version) => version + 1);
    if (opening) {
      setSelection({ kind: "module", id: group.id });
    } else {
      setSelection((current) => {
        if (!current) return current;
        if (current.kind === "module" && current.id === group.id) return null;
        if (current.kind === "file" && group.files.includes(current.path)) return null;
        return current;
      });
    }
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelection({ kind: "file", path });
  }, []);

  // Revealing a file opens its group when folded and scrolls the panel window
  // only as far as needed to put the row inside it.
  const handleRevealFile = useCallback((path: string) => {
    const group = groups.find((entry) => entry.files.includes(path));
    if (group && !expanded.has(group.id)) {
      setExpanded((current) => new Set(current).add(group.id));
      setExpandedVersion((version) => version + 1);
    }
    if (group) {
      setOffsets((current) => {
        const index = group.files.indexOf(path);
        const offset = clampOffset(group, current.get(group.id) ?? 0);
        if (index >= offset && index < offset + PANEL_ROWS) return current;
        const next = new Map(current);
        next.set(group.id, clampOffset(group, index < offset ? index : index - PANEL_ROWS + 1));
        return next;
      });
    }
    setSelection({ kind: "file", path });
  }, [groups, expanded]);

  const handleScroll = useCallback((group: GraphGroup, delta: number) => {
    setOffsets((current) => {
      const next = new Map(current);
      next.set(group.id, clampOffset(group, (next.get(group.id) ?? 0) + delta));
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => setSelection(null), []);

  return (
    <main className="flex min-h-[calc(100vh-65px)] min-w-230 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Analysis preview</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {result.summary.filesParsed} files · {groups.length} modules · click a module to open
          </p>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_17rem]">
        <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/40">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Files</p>
            <p className="mt-1 text-xs text-zinc-400">Categories</p>
          </div>
          <div className="space-y-1 px-3 py-3">
            {categories.map((category) => (
              <div className="flex items-center justify-between gap-2 px-1 py-1.5" key={category.name}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                  <span className="truncate font-mono text-[10px] text-zinc-600 dark:text-zinc-300">{category.name}</span>
                </span>
                <span className="font-mono text-[10px] text-zinc-400">{category.count}</span>
              </div>
            ))}
          </div>
        </aside>
        <section aria-label="Map canvas" className="min-h-0 min-w-0 bg-(--canvas)">
          <ReactFlowProvider>
            <MapCanvas
              categoryByFile={categoryByFile}
              expanded={expanded}
              expandedVersion={expandedVersion}
              groups={groups}
              hover={hover}
              offsets={offsets}
              onClearSelection={handleClearSelection}
              onHover={setHover}
              onScroll={handleScroll}
              onSelectFile={handleSelectFile}
              onToggle={handleToggle}
              result={result}
              selection={selection}
            />
          </ReactFlowProvider>
        </section>
        <DetailPane
          groups={groups}
          hover={hover}
          onHover={setHover}
          onRevealFile={handleRevealFile}
          onTabChange={setDetailsTab}
          result={result}
          selection={selection}
          tab={detailsTab}
        />
      </div>
    </main>
  );
}
