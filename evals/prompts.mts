// Prompt versions: the retired v1 file-explanation prompt and the current one
// run over the same dataset as two experiments, scored side by side.
//
//   npm run eval:prompts -- dataset <github-url>   build the dataset
//   npm run eval:prompts                           run both experiments
import "../scripts/load-env.mts";
import { posix } from "node:path";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { MODEL, flushTraces, openai } from "../lib/ai/client.ts";
import { labelFiles, type ClassifyInput } from "../lib/ai/classify.ts";
import { fileExplanationUser, generateFileExplanation } from "../lib/ai/explain.ts";
import { findInventedPaths, scorePaths } from "../lib/ai/invented-paths.ts";
import { FILE_EXPLANATION_SYSTEM, PROMPT_VERSIONS } from "../lib/ai/prompts.ts";
import { fileNeighbours } from "../lib/graph.ts";
import type { ModelRole } from "../lib/roles.ts";
import { FILE_EXPLANATION_SYSTEM_V1 } from "./retired-prompts.ts";
import { SPECIFICITY_JUDGE_SYSTEM } from "./judge-prompt.ts";
import { withParsedRepo } from "./repo.mts";

const DATASET = "cartograph-file-explanations";
const SAMPLE_SIZE = 20;
const LABEL_BATCH = 20;

const client = new Client();

function evenlySpaced<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const picked = new Set<number>();
  for (let index = 0; index < count; index += 1) picked.add(Math.floor((index * items.length) / count));
  return [...picked].sort((left, right) => left - right).map((index) => items[index]);
}

async function buildDataset(url: string): Promise<void> {
  if (await client.hasDataset({ datasetName: DATASET })) {
    console.error(`Dataset ${DATASET} already exists — delete it in LangSmith first`);
    process.exit(1);
  }

  await withParsedRepo(url, async ({ repository, commit, result, readSource }) => {
    const connected = result.files
      .filter((file) => {
        const neighbours = fileNeighbours(file.path, result.edges);
        return neighbours.imports.length + neighbours.importedBy.length > 0;
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const sample = evenlySpaced(connected, SAMPLE_SIZE);

    // Roles the convention pass left null get the classifier's answer, batched
    // exactly as production batches — the message the eval sends is the
    // message production sends.
    const byPath = new Map(result.files.map((file) => [file.path, file]));
    const needsLabel = new Set<string>();
    for (const file of sample) {
      if (file.role === null) needsLabel.add(file.path);
      const neighbours = fileNeighbours(file.path, result.edges);
      for (const neighbour of [...neighbours.imports, ...neighbours.importedBy]) {
        if (byPath.get(neighbour.path)?.role === null) needsLabel.add(neighbour.path);
      }
    }
    const toLabel: ClassifyInput[] = [];
    for (const filePath of [...needsLabel].sort()) {
      const file = byPath.get(filePath);
      if (file) toLabel.push({ path: file.path, sha256: file.sha256, source: await readSource(file) });
    }
    const modelRoles = new Map<string, ModelRole>();
    for (let index = 0; index < toLabel.length; index += LABEL_BATCH) {
      for (const [labelPath, role] of await labelFiles(toLabel.slice(index, index + LABEL_BATCH))) {
        modelRoles.set(labelPath, role);
      }
    }

    const roleFor = (filePath: string) => byPath.get(filePath)?.role ?? modelRoles.get(filePath) ?? "none";

    const examples = [];
    for (const file of sample) {
      const neighbours = fileNeighbours(file.path, result.edges);
      const user = fileExplanationUser({
        repository,
        path: file.path,
        role: file.role ?? modelRoles.get(file.path) ?? "none identified",
        imports: neighbours.imports.map((neighbour) => ({ path: neighbour.path, role: roleFor(neighbour.path), kinds: neighbour.kinds })),
        importedBy: neighbours.importedBy.map((neighbour) => ({ path: neighbour.path, role: roleFor(neighbour.path), kinds: neighbour.kinds })),
        source: await readSource(file),
      });
      examples.push({
        inputs: {
          path: file.path,
          user,
          shown: [file.path, ...neighbours.imports.map((neighbour) => neighbour.path), ...neighbours.importedBy.map((neighbour) => neighbour.path)],
          base: posix.dirname(file.path),
        },
        metadata: { repository, commit },
      });
    }

    const dataset = await client.createDataset(DATASET, {
      description: "File-explanation user messages built the way the app builds them, for prompt-version comparison",
    });
    await client.createExamples(examples.map((example) => ({ ...example, dataset_id: dataset.id })));
    console.log(`Created ${DATASET} with ${examples.length} examples (${repository}@${commit.slice(0, 7)}, ${sample.length}/${connected.length} connected files)`);
  });
}

// The judge rules per sentence; the score is the share ruled specific, computed
// here — a model-added score would be a second opinion, not an arithmetic.
type JudgeResult = { sentences: Array<{ sentence: string; specific: boolean }> };

function isJudgeResult(value: unknown): value is JudgeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "sentences" in value &&
    Array.isArray(value.sentences) &&
    value.sentences.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "sentence" in entry &&
        typeof entry.sentence === "string" &&
        "specific" in entry &&
        typeof entry.specific === "boolean",
    )
  );
}

const judgeSchema = {
  type: "json_schema",
  json_schema: {
    name: "specificity_grade",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sentence: { type: "string" },
              specific: { type: "boolean" },
            },
            required: ["sentence", "specific"],
            additionalProperties: false,
          },
        },
      },
      required: ["sentences"],
      additionalProperties: false,
    },
  },
} as const;

type ExampleInputs = { path: string; user: string; shown: string[]; base: string };

function isExampleInputs(value: unknown): value is ExampleInputs {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    typeof value.user === "string" &&
    "shown" in value &&
    Array.isArray(value.shown) &&
    value.shown.every((entry) => typeof entry === "string") &&
    "base" in value &&
    typeof value.base === "string"
  );
}

const inventedPathsEvaluator = ({ example, outputs }: { example: { inputs: unknown }; outputs: Record<string, unknown> }) => {
  if (!isExampleInputs(example.inputs)) throw new Error("Dataset example missing expected inputs");
  if (typeof outputs.text !== "string") throw new Error("Target produced no text");
  const result = findInventedPaths(outputs.text, new Set(example.inputs.shown), example.inputs.base);
  return {
    key: "invented_paths",
    score: scorePaths(result),
    comment: result.invented.length === 0 ? "no invented paths" : `invented: ${result.invented.join(", ")}`,
  };
};

const specificityEvaluator = async ({ example, outputs }: { example: { inputs: unknown }; outputs: Record<string, unknown> }) => {
  if (!isExampleInputs(example.inputs)) throw new Error("Dataset example missing expected inputs");
  if (typeof outputs.text !== "string") throw new Error("Target produced no text");
  const completion = await openai.chat.completions.create({
    model: MODEL,
    reasoning_effort: "medium",
    messages: [
      { role: "system", content: SPECIFICITY_JUDGE_SYSTEM },
      {
        role: "user",
        content: `${example.inputs.user}\n\nExplanation to grade:\n<<<\n${outputs.text}\n>>>`,
      },
    ],
    response_format: judgeSchema,
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Judge returned nothing");
  const parsed: unknown = JSON.parse(content);
  if (!isJudgeResult(parsed)) throw new Error("Judge response did not match the schema");
  if (parsed.sentences.length === 0) throw new Error("Judge ruled on no sentences");
  const specific = parsed.sentences.filter((entry) => entry.specific).length;
  const generic = parsed.sentences.filter((entry) => !entry.specific);
  const comment = [`${specific}/${parsed.sentences.length} sentences specific`];
  for (const entry of generic) comment.push(`generic: ${entry.sentence}`);
  return { key: "specificity_model_judged", score: specific / parsed.sentences.length, comment: comment.join("\n") };
};

async function runEvaluation(): Promise<void> {
  const versions = [
    { prefix: "file-explanation-v1", system: FILE_EXPLANATION_SYSTEM_V1, version: "1" },
    { prefix: `file-explanation-v${PROMPT_VERSIONS.fileExplanation}`, system: FILE_EXPLANATION_SYSTEM, version: PROMPT_VERSIONS.fileExplanation },
  ];

  const summaries: Array<{ name: string; clean: number; total: number; scores: number[] }> = [];
  for (const { prefix, system, version } of versions) {
    const results = await evaluate(
      async (input: { user: string }) => ({ text: await generateFileExplanation(system, input.user) }),
      {
        data: DATASET,
        experimentPrefix: prefix,
        maxConcurrency: 4,
        client,
        metadata: { prompt_version: version },
        evaluators: [inventedPathsEvaluator, specificityEvaluator],
      },
    );

    let clean = 0;
    let total = 0;
    const scores: number[] = [];
    for (const row of results.results) {
      total += 1;
      for (const evaluation of row.evaluationResults.results) {
        if (evaluation.key === "invented_paths" && evaluation.score === 1) clean += 1;
        if (evaluation.key === "specificity_model_judged" && typeof evaluation.score === "number") scores.push(evaluation.score);
      }
    }
    summaries.push({ name: results.experimentName, clean, total, scores });
    console.log(`${prefix}: done (${results.experimentName})`);
  }

  const mean = (scores: number[]) => (scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const [v1, v2] = summaries;
  console.log("\nexperiment                       invented-path clean  mean specificity");
  for (const summary of summaries) {
    console.log(
      `${summary.name.padEnd(32)} ${String(`${summary.clean}/${summary.total}`).padEnd(19)} ${(mean(summary.scores) * 100).toFixed(1)}%`,
    );
  }
  if (v1 && v2) {
    console.log(`v2 − v1:                         ${`${v2.clean - v1.clean} run${v2.clean - v1.clean === 1 ? "" : "s"}`.padEnd(19)} ${((mean(v2.scores) - mean(v1.scores)) * 100).toFixed(1)}pp`);
  }
  console.log(
    "\nSpecificity is a model's judgment against a rubric, not a measurement. invented_paths is exact: it is set membership over the paths the prompt showed.",
  );
  console.log(`In LangSmith: open dataset "${DATASET}" → compare the two experiments (file-explanation-v1 vs ${v2?.name ?? "file-explanation-v2"}).`);

  await flushTraces();
}

const args = process.argv.slice(2);
if (args[0] === "dataset") {
  const url = args[1];
  if (!url) {
    console.error("Usage: npm run eval:prompts -- dataset <github-url>");
    process.exit(1);
  }
  await buildDataset(url);
} else {
  await runEvaluation();
}
