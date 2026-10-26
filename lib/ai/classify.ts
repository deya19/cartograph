import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentRunTree } from "langsmith/traceable";
import { isModelRole, MODEL_ROLES, type ModelRole } from "../roles.ts";
import { MODEL, openai, traced } from "./client.ts";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { CLASSIFICATION_SYSTEM, PROMPT_VERSIONS } from "./prompts.ts";

export type ClassifyInput = { path: string; sha256: string; source: string };

const BATCH_SIZE = 20;
const CONCURRENCY = 4;
const SOURCE_LINE_LIMIT = 150;
const SOURCE_CHAR_LIMIT = 4000;

type LabelsResponse = { labels: Array<{ path: string; role: string }> };

function isLabelsResponse(value: unknown): value is LabelsResponse {
  if (typeof value !== "object" || value === null || !("labels" in value)) return false;
  const { labels } = value;
  return (
    Array.isArray(labels) &&
    labels.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "path" in item &&
        "role" in item &&
        typeof item.path === "string" &&
        typeof item.role === "string",
    )
  );
}

const labelsSchema = {
  type: "json_schema",
  json_schema: {
    name: "labels",
    strict: true,
    schema: {
      type: "object",
      properties: {
        labels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              role: { type: "string", enum: MODEL_ROLES },
            },
            required: ["path", "role"],
            additionalProperties: false,
          },
        },
      },
      required: ["labels"],
      additionalProperties: false,
    },
  },
} as const;

function excerpt(source: string): string {
  return source.split("\n").slice(0, SOURCE_LINE_LIMIT).join("\n").slice(0, SOURCE_CHAR_LIMIT);
}

// The model call with no cache or tracing wrapper. The evals label files
// through this directly: an experiment measures the model, and a cached
// answer would measure nothing. Throws if any given path goes unanswered;
// answers for paths never given are ignored.
export async function labelFiles(files: ClassifyInput[]): Promise<Map<string, ModelRole>> {
  const user = files.map((file) => `File: ${file.path}\n<<<\n${excerpt(file.source)}\n>>>`).join("\n\n");
  const completion = await openai.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: CLASSIFICATION_SYSTEM },
      { role: "user", content: user },
    ],
    response_format: labelsSchema,
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Model returned no labels");

  const parsed: unknown = JSON.parse(content);
  if (!isLabelsResponse(parsed)) throw new Error("Model labels response did not match the schema");

  const given = new Set(files.map((file) => file.path));
  const labelled = new Map<string, ModelRole>();
  for (const label of parsed.labels) {
    // The model may answer for a path it was never given — those are ignored;
    // a path it was given and didn't answer fails below.
    if (!given.has(label.path) || !isModelRole(label.role)) continue;
    labelled.set(label.path, label.role);
  }
  const unanswered = files.filter((file) => !labelled.has(file.path)).map((file) => file.path);
  if (unanswered.length > 0) {
    throw new Error(`Model did not label ${unanswered.length} file(s): ${unanswered.join(", ")}`);
  }
  return labelled;
}

// One batch is one traced run: the cache read happens inside it, so a fully
// cached batch shows as a recorded run with no model call.
async function classifyBatch(
  client: SupabaseClient,
  organizationId: string,
  files: ClassifyInput[],
): Promise<Map<string, ModelRole>> {
  const keys = new Map(files.map((file) => [file.path, cacheKey(["classification", PROMPT_VERSIONS.classification, MODEL, file.path, file.sha256])]));

  // Returns a plain object rather than a Map — a Map serialises to {} in the
  // run's outputs and the trace would record nothing.
  const labels = await traced(
    "classify-files",
    { files: files.map((file) => ({ path: file.path, hash: file.sha256 })) },
    async (): Promise<Record<string, ModelRole>> => {
    const cached = await readCache(client, organizationId, [...keys.values()]);
    const labelled = new Map<string, ModelRole>();
    const misses: ClassifyInput[] = [];
    for (const file of files) {
      const hit = cached.get(keys.get(file.path) ?? "");
      if (hit !== undefined && isModelRole(hit)) {
        labelled.set(file.path, hit);
      } else {
        misses.push(file);
      }
    }

    if (misses.length === 0) {
      const runTree = getCurrentRunTree(true);
      if (runTree) runTree.metadata = { ...runTree.metadata, cache: "hit" };
      return Object.fromEntries(labelled);
    }
    const runTree = getCurrentRunTree(true);
    if (runTree) runTree.metadata = { ...runTree.metadata, cache: labelled.size > 0 ? "partial" : "miss" };

    const fresh = await labelFiles(misses);
    const rows: Array<{ organization_id: string; kind: "classification"; cache_key: string; content: string }> = [];
    for (const [labelPath, role] of fresh) {
      labelled.set(labelPath, role);
      rows.push({
        organization_id: organizationId,
        kind: "classification",
        cache_key: keys.get(labelPath) ?? "",
        content: role,
      });
    }

    await writeCache(client, rows);
    return Object.fromEntries(labelled);
  });

  return new Map(Object.entries(labels));
}

export async function classifyFiles({
  client,
  organizationId,
  files,
}: {
  client: SupabaseClient;
  organizationId: string;
  files: ClassifyInput[];
}): Promise<Map<string, ModelRole>> {
  const batches: ClassifyInput[][] = [];
  for (let index = 0; index < files.length; index += BATCH_SIZE) {
    batches.push(files.slice(index, index + BATCH_SIZE));
  }

  const labelled = new Map<string, ModelRole>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < batches.length) {
      const batch = batches[next];
      next += 1;
      for (const [path, role] of await classifyBatch(client, organizationId, batch)) {
        labelled.set(path, role);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
  return labelled;
}
