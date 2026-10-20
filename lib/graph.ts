import type { Edge, EdgeKind, FileMetrics, FileRecord, FileRole, ParseResult } from "./parser/types";

export type GraphGroup = {
  id: string;
  path: string;
  label: string;
  files: string[];
  fanIn: number;
  fanOut: number;
};

type GroupSeed = {
  path: string;
  files: string[];
};

type DirectoryResult = {
  groups: GroupSeed[];
  carry: string[];
  files: string[];
};

function directoryName(directory: string): string {
  if (directory === ".") return "root";
  return directory.split("/").at(-1) ?? directory;
}

function buildDirectories(files: FileRecord[]): Map<string, { files: string[]; children: string[] }> {
  const directories = new Map<string, { files: string[]; children: string[] }>();
  directories.set(".", { files: [], children: [] });

  for (const file of files) {
    const parts = file.directory === "." ? [] : file.directory.split("/");
    let current = ".";
    directories.get(current)?.files.push(file.path);

    for (const part of parts) {
      const next = current === "." ? part : `${current}/${part}`;
      if (!directories.has(next)) {
        directories.set(next, { files: [], children: [] });
        directories.get(current)?.children.push(next);
      }
      current = next;
      directories.get(current)?.files.push(file.path);
    }
  }

  return directories;
}

function partitionAtThreshold(files: FileRecord[], threshold: number): GroupSeed[] {
  const directories = buildDirectories(files);

  function visit(directory: string): DirectoryResult {
    const entry = directories.get(directory);
    if (!entry) return { groups: [], carry: [], files: [] };

    const groups: GroupSeed[] = [];
    let carry = [...filesDirectlyInDirectory(files, directory)];
    const allFiles = [...entry.files];

    for (const child of [...entry.children].sort()) {
      const childResult = visit(child);
      if (childResult.files.length < threshold) {
        carry.push(...childResult.files);
      } else {
        groups.push(...childResult.groups);
        carry.push(...childResult.carry);
      }
    }

    if (carry.length >= threshold || directory === ".") {
      groups.unshift({ path: directory, files: [...new Set(carry)].sort() });
      carry = [];
    }

    return { groups, carry, files: allFiles };
  }

  // A group with zero files only happens when the root has nothing left over;
  // anything stricter would drop files and leave edges dangling.
  return visit(".").groups.filter((group) => group.files.length > 0);
}

function filesDirectlyInDirectory(files: FileRecord[], directory: string): string[] {
  return files.filter((file) => file.directory === directory).map((file) => file.path);
}

function uniqueLabels(groups: GroupSeed[]): Map<string, string> {
  const labels = new Map<string, string>();
  const used = new Set<string>();

  for (const group of groups) {
    const parts = group.path === "." ? ["root"] : group.path.split("/");
    let depth = 1;
    let label = parts.at(-1) ?? "root";
    while (used.has(label) && depth < parts.length) {
      depth += 1;
      label = parts.slice(-depth).join("/");
    }
    while (used.has(label)) label = `${label} · ${depth++}`;
    used.add(label);
    labels.set(group.path, label);
  }

  return labels;
}

function groupMetrics(groups: GroupSeed[], edges: ParseResult["edges"]): Map<string, FileMetrics> {
  const fileToGroup = new Map<string, string>();
  for (const group of groups) {
    for (const file of group.files) fileToGroup.set(file, group.path);
  }

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const group of groups) {
    incoming.set(group.path, new Set());
    outgoing.set(group.path, new Set());
  }

  for (const edge of edges) {
    const from = fileToGroup.get(edge.from);
    const to = fileToGroup.get(edge.to);
    if (!from || !to || from === to) continue;
    // Distinct external files on the other end, not raw edge counts.
    incoming.get(to)?.add(edge.from);
    outgoing.get(from)?.add(edge.to);
  }

  return new Map(groups.map((group) => [
    group.path,
    { fanIn: incoming.get(group.path)?.size ?? 0, fanOut: outgoing.get(group.path)?.size ?? 0 },
  ]));
}

// Same counting as the parser's metrics: every edge row counts, not distinct
// file pairs — one file pair can hold several import kinds.
export function fileMetrics(files: FileRecord[], edges: Edge[]): Record<string, FileMetrics> {
  const metrics: Record<string, FileMetrics> = Object.fromEntries(files.map((file) => [file.path, { fanIn: 0, fanOut: 0 }]));
  for (const edge of edges) {
    metrics[edge.from].fanOut += 1;
    metrics[edge.to].fanIn += 1;
  }
  return metrics;
}

export function foldModules(result: ParseResult, maximumNodes = 24): GraphGroup[] {
  let threshold = 2;
  let groups = partitionAtThreshold(result.files, threshold);
  while (groups.length > maximumNodes && threshold < result.files.length) {
    threshold += 1;
    groups = partitionAtThreshold(result.files, threshold);
  }

  const labels = uniqueLabels(groups);
  const metrics = groupMetrics(groups, result.edges);
  return groups
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((group) => ({
      id: `module:${group.path}`,
      path: group.path,
      label: labels.get(group.path) ?? directoryName(group.path),
      files: group.files,
      fanIn: metrics.get(group.path)?.fanIn ?? 0,
      fanOut: metrics.get(group.path)?.fanOut ?? 0,
    }));
}

export const PANEL_ROWS = 10;

export type PanelRow = { id: string; file: string; label: string };

export type VisibleItem =
  | { kind: "module"; id: string; group: GraphGroup }
  | {
      kind: "panel";
      id: string;
      group: GraphGroup;
      rows: PanelRow[];
      above: string[];
      hidden: string[];
      overflows: boolean;
    };

export type VisibleEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  count: number;
  files: Edge[];
};

export function clampOffset(group: GraphGroup, offset: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, group.files.length - PANEL_ROWS)));
}

export function visibleGraph(
  groups: GraphGroup[],
  edges: Edge[],
  expanded: ReadonlySet<string>,
  offsets: ReadonlyMap<string, number> = new Map(),
): { items: VisibleItem[]; edges: VisibleEdge[] } {
  const fileToGroup = new Map<string, GraphGroup>();
  for (const group of groups) {
    for (const file of group.files) fileToGroup.set(file, group);
  }

  // Files scrolled off a panel land on the "::above"/"::more" cap lines, never
  // on whichever row happens to be first or last.
  const rowByFile = new Map<string, PanelRow>();
  const aboveFiles = new Set<string>();
  const items: VisibleItem[] = [];
  for (const group of groups) {
    if (!expanded.has(group.id)) {
      items.push({ kind: "module", id: group.id, group });
      continue;
    }
    const prefix = group.path === "." ? "" : `${group.path}/`;
    const offset = clampOffset(group, offsets.get(group.id) ?? 0);
    const rows = group.files.slice(offset, offset + PANEL_ROWS).map((file) => ({
      id: `${group.id}::${file}`,
      file,
      label: file.startsWith(prefix) ? file.slice(prefix.length) : file,
    }));
    for (const row of rows) rowByFile.set(row.file, row);
    const above = group.files.slice(0, offset);
    for (const file of above) aboveFiles.add(file);
    items.push({
      kind: "panel",
      id: group.id,
      group,
      rows,
      above,
      hidden: group.files.slice(offset + PANEL_ROWS),
      overflows: group.files.length > PANEL_ROWS,
    });
  }

  function endpoint(file: string, direction: "in" | "out"): { node: string; handle: string } | null {
    const group = fileToGroup.get(file);
    if (!group) return null;
    if (!expanded.has(group.id)) return { node: group.id, handle: direction };
    const row = rowByFile.get(file);
    const suffix = row ? row.id : aboveFiles.has(file) ? `${group.id}::above` : `${group.id}::more`;
    return { node: group.id, handle: `${direction}:${suffix}` };
  }

  const merged = new Map<string, { source: string; sourceHandle: string; target: string; targetHandle: string; files: Edge[] }>();
  for (const edge of edges) {
    const from = fileToGroup.get(edge.from);
    const to = fileToGroup.get(edge.to);
    if (!from || !to || from.id === to.id) continue;
    const source = endpoint(edge.from, "out");
    const target = endpoint(edge.to, "in");
    if (!source || !target) continue;
    const id = `${source.node}|${source.handle}|${target.node}|${target.handle}`;
    const entry = merged.get(id) ?? { source: source.node, sourceHandle: source.handle, target: target.node, targetHandle: target.handle, files: [] };
    entry.files.push(edge);
    merged.set(id, entry);
  }

  const visibleEdges = [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => ({ id, ...entry, count: entry.files.length }));

  return { items, edges: visibleEdges };
}

export type Neighbour = { path: string; kinds: EdgeKind[] };

// Distinct files on the other side of an edge, not edge rows — one file pair
// can hold several kinds, and the pane's counts are these list lengths.
export function fileNeighbours(path: string, edges: Edge[]): { imports: Neighbour[]; importedBy: Neighbour[] } {
  const imports = new Map<string, EdgeKind[]>();
  const importedBy = new Map<string, EdgeKind[]>();

  const add = (map: Map<string, EdgeKind[]>, other: string, kind: EdgeKind) => {
    const kinds = map.get(other) ?? [];
    if (!kinds.includes(kind)) kinds.push(kind);
    map.set(other, kinds);
  };

  for (const edge of edges) {
    if (edge.from === path) add(imports, edge.to, edge.kind);
    if (edge.to === path) add(importedBy, edge.from, edge.kind);
  }

  const sorted = (map: Map<string, EdgeKind[]>): Neighbour[] =>
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([other, kinds]) => ({ path: other, kinds }));

  return { imports: sorted(imports), importedBy: sorted(importedBy) };
}

export function repositorySummary(
  files: FileRecord[],
  edges: Edge[],
  limit = 10,
): { mostImported: Array<{ path: string; importers: number }>; unimported: Array<{ path: string; imports: number }>; unimportedTotal: number } {
  const importers = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();
  for (const file of files) {
    importers.set(file.path, new Set());
    imports.set(file.path, new Set());
  }
  for (const edge of edges) {
    importers.get(edge.to)?.add(edge.from);
    imports.get(edge.from)?.add(edge.to);
  }

  const mostImported = files
    .filter((file) => (importers.get(file.path)?.size ?? 0) > 0)
    .map((file) => ({ path: file.path, importers: importers.get(file.path)?.size ?? 0 }))
    .sort((left, right) => right.importers - left.importers || left.path.localeCompare(right.path))
    .slice(0, limit);

  const unimportedFiles = files
    .filter((file) => (importers.get(file.path)?.size ?? 0) === 0)
    .map((file) => ({ path: file.path, imports: imports.get(file.path)?.size ?? 0 }))
    .sort((left, right) => right.imports - left.imports || left.path.localeCompare(right.path));

  return { mostImported, unimported: unimportedFiles.slice(0, limit), unimportedTotal: unimportedFiles.length };
}

export type Adjacency = {
  dependents: ReadonlyMap<string, readonly string[]>;
  dependencies: ReadonlyMap<string, readonly string[]>;
};

export function buildAdjacency(edges: Edge[]): Adjacency {
  const dependents = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  for (const edge of edges) {
    const dep = dependents.get(edge.to) ?? new Set<string>();
    dep.add(edge.from);
    dependents.set(edge.to, dep);
    const req = dependencies.get(edge.from) ?? new Set<string>();
    req.add(edge.to);
    dependencies.set(edge.from, req);
  }
  const sorted = (map: Map<string, Set<string>>) =>
    new Map([...map.entries()].map(([key, value]) => [key, [...value].sort()]));
  return { dependents: sorted(dependents), dependencies: sorted(dependencies) };
}

export function transitiveWalk(
  adjacency: Adjacency,
  start: string,
  direction: "dependents" | "dependencies",
  depth = 2,
): Array<{ path: string; depth: number }> {
  // Depth 2 by default: deeper reaches most of a real repository and stops
  // being an answer.
  const neighbours = adjacency[direction];
  const seen = new Set([start]);
  const found: Array<{ path: string; depth: number }> = [];
  let frontier = [start];
  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of neighbours.get(node) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        found.push({ path: neighbour, depth: level });
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return found.sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
}

export const LONG_FILE_LINES = 500;

export const INSIGHT_SENTENCES = {
  unimported: "Nothing in the repository imports this file.",
  heavilyImported: "Imported by far more files than most.",
  cycles: "These files import each other in a loop.",
  long: `This file is over ${LONG_FILE_LINES} lines.`,
} as const;

export type Insights = {
  unimported: string[];
  unimportedReached: number;
  heavilyImported: Array<{ path: string; importers: number }>;
  cycles: Array<{ files: string[]; groupSize: number }>;
  long: Array<{ path: string; lines: number }>;
};

// Iterative Tarjan: a real repository's import graph is deep enough to blow
// the call stack, so the recursion stays explicit.
function stronglyConnected(files: FileRecord[], dependencies: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const file of files) {
    if (index.has(file.path)) continue;
    const work: Array<{ node: string; child: number }> = [{ node: file.path, child: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const node = frame.node;
      if (frame.child === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const neighbours = dependencies.get(node) ?? [];
      if (frame.child < neighbours.length) {
        const next = neighbours[frame.child];
        frame.child += 1;
        if (!index.has(next)) {
          work.push({ node: next, child: 0 });
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
        }
      } else {
        work.pop();
        const parent = work.at(-1);
        if (parent) low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(node) ?? 0));
        if (low.get(node) === index.get(node)) {
          const component: string[] = [];
          let member = "";
          do {
            member = stack.pop() ?? "";
            onStack.delete(member);
            component.push(member);
          } while (member !== node);
          components.push(component);
        }
      }
    }
  }
  return components;
}

// Shortest way back to start inside the component: BFS with neighbours in
// sorted order keeps the reported cycle deterministic.
function cycleThrough(start: string, members: ReadonlySet<string>, dependencies: ReadonlyMap<string, readonly string[]>): string[] {
  const previous = new Map<string, string>();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift() ?? "";
    const neighbours = [...(dependencies.get(node) ?? [])].sort();
    for (const next of neighbours) {
      if (!members.has(next)) continue;
      if (next === start) {
        const path = [node];
        let cursor = node;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor) ?? cursor;
          path.unshift(cursor);
        }
        return path;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, node);
      queue.push(next);
    }
  }
  return [start];
}

export function insights(files: FileRecord[], edges: Edge[], reachedRoles: ReadonlySet<FileRole>): Insights {
  const adjacency = buildAdjacency(edges);

  const importers = new Map<string, number>();
  for (const file of files) importers.set(file.path, 0);
  for (const [path, sources] of adjacency.dependents) {
    if (importers.has(path)) importers.set(path, sources.length);
  }

  const noImporters = files.filter((file) => (importers.get(file.path) ?? 0) === 0);
  // Only a reached role means the framework, config or test runner gets to
  // the file — a Nest service nothing imports is genuinely unimported.
  const unimported = noImporters.filter((file) => file.role === null || !reachedRoles.has(file.role)).map((file) => file.path).sort();
  const unimportedReached = noImporters.length - unimported.length;

  const counts = files.map((file) => importers.get(file.path) ?? 0);
  const mean = counts.reduce((sum, count) => sum + count, 0) / Math.max(1, counts.length);
  const variance = counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / Math.max(1, counts.length);
  const threshold = mean + 2 * Math.sqrt(variance);
  const heavilyImported = files
    .filter((file) => (importers.get(file.path) ?? 0) > threshold)
    .map((file) => ({ path: file.path, importers: importers.get(file.path) ?? 0 }))
    .sort((left, right) => right.importers - left.importers || left.path.localeCompare(right.path));

  const selfEdge = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) selfEdge.add(edge.from);
  }
  const cycles = stronglyConnected(files, adjacency.dependencies)
    .filter((component) => component.length > 1 || selfEdge.has(component[0]))
    .map((component) => {
      const members = new Set(component);
      const start = [...component].sort()[0];
      return { files: cycleThrough(start, members, adjacency.dependencies), groupSize: component.length };
    })
    .sort((left, right) => right.groupSize - left.groupSize || (left.files[0] ?? "").localeCompare(right.files[0] ?? ""));

  const long = files
    .filter((file) => file.lines > LONG_FILE_LINES)
    .map((file) => ({ path: file.path, lines: file.lines }))
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

  return { unimported, unimportedReached, heavilyImported, cycles, long };
}

export function graphAcceptance(result: ParseResult, groups: GraphGroup[]): { nodeCount: number; allNodesHaveMultipleFiles: boolean; danglingEdges: number } {
  const files = new Set(groups.flatMap((group) => group.files));
  const danglingEdges = result.edges.filter((edge) => !files.has(edge.from) || !files.has(edge.to)).length;
  return {
    nodeCount: groups.length,
    allNodesHaveMultipleFiles: groups.every((group) => group.files.length > 1),
    danglingEdges,
  };
}
