import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentRunTree } from "langsmith/traceable";
import { fileNeighbours, foldModules } from "../graph.ts";
import type { Neighbour } from "../graph.ts";
import { fetchRawFile } from "../pipeline/github.ts";
import type { FileRecord, ParseResult } from "../parser/types.ts";
import type { ModelRole } from "../roles.ts";
import { MODEL, openai, recordFeedback, traced } from "./client.ts";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { findInventedPaths, scorePaths, shownPaths } from "./invented-paths.ts";
import { FILE_EXPLANATION_SYSTEM, FOLDER_EXPLANATION_SYSTEM, PROMPT_VERSIONS } from "./prompts.ts";

export type ExplainContext = {
  client: SupabaseClient;
  organizationId: string;
  repository: { owner: string; repo: string };
  // Always the analysed commit — explaining head's source against the
  // analysed graph would describe a file that may no longer match.
  commitSha: string;
  result: ParseResult;
  modelRoles: Record<string, ModelRole>;
};

export type Explanation = { text: string; cached: boolean };

const SOURCE_CHAR_LIMIT = 60_000;

// Records hit/miss on the run so a cache hit reads as a traced run with no
// model call inside it.
function markCache(outcome: "hit" | "miss"): void {
  const run = getCurrentRunTree(true);
  if (run) run.metadata = { ...run.metadata, cache: outcome };
}

function neighbourKey(neighbours: Neighbour[]): string[] {
  return neighbours.map((neighbour) => `${neighbour.path}|${neighbour.kinds.join(",")}`).sort();
}

// Trace inputs carry null rather than the prompt's "none" — the pane reads
// what was actually identified.
function inputRole(path: string, byPath: Map<string, FileRecord>, modelRoles: Record<string, ModelRole>): string | null {
  return byPath.get(path)?.role ?? modelRoles[path] ?? null;
}

function inputNeighbours(neighbours: Neighbour[], byPath: Map<string, FileRecord>, modelRoles: Record<string, ModelRole>) {
  return neighbours.map((neighbour) => ({ path: neighbour.path, role: inputRole(neighbour.path, byPath, modelRoles), kinds: neighbour.kinds }));
}

function roleFor(path: string, byPath: Map<string, FileRecord>, modelRoles: Record<string, ModelRole>): string {
  return byPath.get(path)?.role ?? modelRoles[path] ?? "none";
}

// Records the invented-path check on the current run — inside the traced call
// so the feedback lands on that run, hit or miss alike.
function recordInventedPaths(runName: "explain-file" | "explain-folder", inputs: Record<string, unknown>, text: string): void {
  const { paths, base } = shownPaths(runName, inputs);
  const result = findInventedPaths(text, paths, base);
  const comment =
    result.invented.length === 0
      ? "no invented paths"
      : `invented: ${result.invented.join(", ")}`;
  recordFeedback("invented_paths", scorePaths(result), comment);
}

export type FileExplanationUserParams = {
  repository: string;
  path: string;
  role: string;
  imports: Array<{ path: string; role: string; kinds: string[] }>;
  importedBy: Array<{ path: string; role: string; kinds: string[] }>;
  source: string;
};

// The user message exactly as the app sends it, factored out so the evals
// build the same message rather than a lookalike. Truncation lives here so
// the eval can't accidentally measure on a source the app never sends.
export function fileExplanationUser({ repository, path, role, imports, importedBy, source }: FileExplanationUserParams): string {
  if (source.length > SOURCE_CHAR_LIMIT) {
    source = `${source.slice(0, SOURCE_CHAR_LIMIT)}\n[truncated: ${source.length - SOURCE_CHAR_LIMIT} more characters not shown]`;
  }
  const lines = (entries: Array<{ path: string; role: string; kinds: string[] }>): string[] =>
    entries.length === 0 ? ["- none"] : entries.map((entry) => `- ${entry.path} (role: ${entry.role}; ${entry.kinds.join(", ")})`);

  return [
    `Repository: ${repository}`,
    `File: ${path} (role: ${role})`,
    "",
    `Imports (${imports.length}):`,
    ...lines(imports),
    "",
    `Imported by (${importedBy.length}):`,
    ...lines(importedBy),
    "",
    `Source of ${path}:`,
    "<<<",
    source,
    ">>>",
  ].join("\n");
}

// Bare model call with no cache: the evals call this directly, because an
// experiment measures the model — a cached answer would measure nothing.
export async function generateFileExplanation(system: string, user: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = completion.choices[0]?.message.content;
  if (!text) throw new Error("Model returned no explanation");
  return text;
}

async function fetchSourceAtCommit(repository: { owner: string; repo: string }, commitSha: string, path: string, expectedSha256: string): Promise<string> {
  const { status, text } = await fetchRawFile(repository.owner, repository.repo, commitSha, path);
  if (text === null) {
    throw new Error(`Could not fetch ${path} at ${commitSha.slice(0, 7)} from GitHub: HTTP ${status}`);
  }
  const source = text;
  // The parser hashes the utf8 content it read, so the fetched text is hashed
  // the same way — a mismatch means this is not the analysed content.
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(`Fetched source for ${path} does not match the analysed content hash`);
  }
  return source;
}

export async function explainFile(context: ExplainContext & { path: string }): Promise<Explanation> {
  const { client, organizationId, repository, commitSha, result, modelRoles, path } = context;
  const file = result.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`File not in this analysis: ${path}`);

  const byPath = new Map(result.files.map((entry) => [entry.path, entry]));
  const neighbours = fileNeighbours(path, result.edges);
  const key = cacheKey([
    "file-explanation",
    PROMPT_VERSIONS.fileExplanation,
    MODEL,
    path,
    file.sha256,
    neighbourKey(neighbours.imports),
    neighbourKey(neighbours.importedBy),
  ]);

  // Hoisted so the trace inputs and the invented-path check see the identical
  // object — the check is only exact when it checks what the prompt showed.
  const inputs = {
    path,
    hash: file.sha256,
    role: file.role ?? modelRoles[path] ?? null,
    imports: inputNeighbours(neighbours.imports, byPath, modelRoles),
    importedBy: inputNeighbours(neighbours.importedBy, byPath, modelRoles),
  };

  // The cache read lives inside the traced call: a hit must show up as a run
  // with no model call in it, otherwise a working cache looks like a broken one.
  return traced(
    "explain-file",
    inputs,
    async (): Promise<Explanation> => {
    const cached = await readCache(client, organizationId, [key]);
    const hit = cached.get(key);
    if (hit !== undefined) {
      markCache("hit");
      recordInventedPaths("explain-file", inputs, hit);
      return { text: hit, cached: true };
    }
    markCache("miss");

    const source = await fetchSourceAtCommit(repository, commitSha, path, file.sha256);
    const explain = (entries: Neighbour[]) =>
      entries.map((neighbour) => ({
        path: neighbour.path,
        role: roleFor(neighbour.path, byPath, modelRoles),
        kinds: neighbour.kinds,
      }));
    const user = fileExplanationUser({
      repository: `${repository.owner}/${repository.repo}`,
      path,
      role: file.role ?? modelRoles[path] ?? "none identified",
      imports: explain(neighbours.imports),
      importedBy: explain(neighbours.importedBy),
      source,
    });

    const text = await generateFileExplanation(FILE_EXPLANATION_SYSTEM, user);

    await writeCache(client, [
      { organization_id: organizationId, kind: "file-explanation", cache_key: key, content: text },
    ]);
    recordInventedPaths("explain-file", inputs, text);
    return { text, cached: false };
    },
  );
}

const TARGET_IMPORTERS_LIMIT = 20;
const OUTSIDE_IMPORTS_LIMIT = 40;

export async function explainFolder(context: ExplainContext & { groupId: string }): Promise<Explanation> {
  const { client, organizationId, repository, result, modelRoles, groupId } = context;

  const groups = foldModules(result);
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) throw new Error(`Module not in this analysis: ${groupId}`);

  const byPath = new Map(result.files.map((entry) => [entry.path, entry]));
  const members = new Set(group.files);

  // Incoming edges grouped by the inside file they target; outgoing counted
  // per outside file the folder points at.
  const incomingByTarget = new Map<string, string[]>();
  const outgoingCounts = new Map<string, number>();
  const incomingPairs: string[] = [];
  const outgoingPairs: string[] = [];
  for (const edge of result.edges) {
    const fromInside = members.has(edge.from);
    const toInside = members.has(edge.to);
    if (!fromInside && toInside) {
      incomingPairs.push(`${edge.from}>${edge.to}`);
      const importers = incomingByTarget.get(edge.to) ?? [];
      if (!importers.includes(edge.from)) importers.push(edge.from);
      incomingByTarget.set(edge.to, importers);
    } else if (fromInside && !toInside) {
      outgoingPairs.push(`${edge.from}>${edge.to}`);
      outgoingCounts.set(edge.to, (outgoingCounts.get(edge.to) ?? 0) + 1);
    }
  }

  const key = cacheKey([
    "folder-explanation",
    PROMPT_VERSIONS.folderExplanation,
    MODEL,
    group.path,
    group.files.map((path) => `${path}|${byPath.get(path)?.sha256 ?? ""}`).sort(),
    incomingPairs.sort(),
    outgoingPairs.sort(),
  ]);

  const incoming = [...incomingByTarget.entries()]
    .map(([target, importers]) => ({ target, importers: importers.sort() }))
    .sort((left, right) => left.target.localeCompare(right.target));
  const outgoing = [...outgoingCounts.entries()].sort(([left], [right]) => left.localeCompare(right));

  // Same object the traced call records — the folder inputs apply the prompt's
  // truncation limits identically, so the check sees what the model saw.
  const inputs = {
    folder: group.path,
    files: group.files.map((path) => ({ path, role: inputRole(path, byPath, modelRoles), lines: byPath.get(path)?.lines ?? 0 })),
    importedFrom: incoming.map(({ target, importers }) => ({ target, importers: importers.slice(0, TARGET_IMPORTERS_LIMIT) })),
    importsOutside: outgoing.slice(0, OUTSIDE_IMPORTS_LIMIT).map(([path, count]) => ({ path, count })),
  };

  return traced(
    "explain-folder",
    inputs,
    async (): Promise<Explanation> => {
    const cached = await readCache(client, organizationId, [key]);
    const hit = cached.get(key);
    if (hit !== undefined) {
      markCache("hit");
      recordInventedPaths("explain-folder", inputs, hit);
      return { text: hit, cached: true };
    }
    markCache("miss");

    const lines: string[] = [
      `Repository: ${repository.owner}/${repository.repo}`,
      `Folder: ${group.path} (${group.files.length} files)`,
      "",
      `Files in this folder (${group.files.length}):`,
      ...group.files.map((path) => {
        const file = byPath.get(path);
        return `- ${path} (role: ${file ? roleFor(path, byPath, modelRoles) : "none"}; ${file?.lines ?? 0} lines)`;
      }),
      "",
      "Imported from outside, by target file:",
    ];

    if (incoming.length === 0) {
      lines.push("- none");
    }
    for (const { target, importers } of incoming) {
      lines.push(`- ${target}:`);
      for (const importer of importers.slice(0, TARGET_IMPORTERS_LIMIT)) {
        lines.push(`  - ${importer}`);
      }
      if (importers.length > TARGET_IMPORTERS_LIMIT) {
        lines.push(`  - +${importers.length - TARGET_IMPORTERS_LIMIT} more importers not listed`);
      }
    }

    lines.push("", `Imports from outside the folder (${outgoing.length}):`);
    if (outgoing.length === 0) {
      lines.push("- none");
    }
    for (const [path, count] of outgoing.slice(0, OUTSIDE_IMPORTS_LIMIT)) {
      lines.push(`- ${path} (${count} import${count === 1 ? "" : "s"})`);
    }
    if (outgoing.length > OUTSIDE_IMPORTS_LIMIT) {
      lines.push(`- +${outgoing.length - OUTSIDE_IMPORTS_LIMIT} more not listed`);
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: FOLDER_EXPLANATION_SYSTEM },
        { role: "user", content: lines.join("\n") },
      ],
    });
    const text = completion.choices[0]?.message.content;
    if (!text) throw new Error(`Model returned no explanation for folder ${group.path}`);

    await writeCache(client, [
      { organization_id: organizationId, kind: "folder-explanation", cache_key: key, content: text },
    ]);
    recordInventedPaths("explain-folder", inputs, text);
    return { text, cached: false };
    },
  );
}
