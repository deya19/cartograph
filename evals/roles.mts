// Role accuracy: files whose role convention assigned with certainty are a
// held-out set — in production they never reach the classifier. Hide the
// role, ask the model, compare.
//
//   npm run eval:roles -- dataset <github-url>...   build the dataset
//   npm run eval:roles                              run the experiment
import "../scripts/load-env.mts";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { labelFiles, type ClassifyInput } from "../lib/ai/classify.ts";
import { flushTraces } from "../lib/ai/client.ts";
import { PROMPT_VERSIONS } from "../lib/ai/prompts.ts";
import { isModelRole, type ModelRole } from "../lib/roles.ts";
import { withParsedRepo } from "./repo.mts";

const DATASET = "cartograph-roles";
const PER_ROLE_CAP = 40;
const MINIMUM_EXAMPLES = 30;

const client = new Client();

async function buildDataset(urls: string[]): Promise<void> {
  if (await client.hasDataset({ datasetName: DATASET })) {
    console.error(`Dataset ${DATASET} already exists — delete it in LangSmith first`);
    process.exit(1);
  }

  // Only files whose conventional role is a ModelRole: the classifier is
  // forbidden to emit anything else, so scoring it on a question it can't
  // answer (a controller, a page) measures nothing.
  const examples: Array<{
    inputs: { path: string; sha256: string; source: string };
    outputs: { role: ModelRole };
    metadata: { repository: string; commit: string; adapter: string };
  }> = [];
  const perRole = new Map<string, number>();

  for (const url of urls) {
    console.log(`Parsing ${url}…`);
    await withParsedRepo(url, async ({ repository, commit, result, readSource }) => {
      // Deterministic cap: path-sorted, at most PER_ROLE_CAP files of one role
      // across the whole dataset, so one repo can't flood a role.
      for (const file of [...result.files].sort((left, right) => left.path.localeCompare(right.path))) {
        if (file.role === null || !isModelRole(file.role)) continue;
        const count = perRole.get(file.role) ?? 0;
        if (count >= PER_ROLE_CAP) continue;
        perRole.set(file.role, count + 1);
        examples.push({
          inputs: { path: file.path, sha256: file.sha256, source: await readSource(file) },
          outputs: { role: file.role },
          metadata: { repository, commit, adapter: result.adapter },
        });
      }
      console.log(`  ${repository}: ${result.files.length} files parsed`);
    });
  }

  if (examples.length < MINIMUM_EXAMPLES) {
    console.error(`Only ${examples.length} eligible examples (need ${MINIMUM_EXAMPLES}); dataset not created. Per role:`);
    for (const [role, count] of [...perRole.entries()].sort()) console.error(`  ${role}: ${count}`);
    process.exit(1);
  }

  const dataset = await client.createDataset(DATASET, {
    description: "Files with convention-assigned ModelRoles — ground truth for classifier accuracy",
  });
  await client.createExamples(examples.map((example) => ({ ...example, dataset_id: dataset.id })));
  console.log(`Created ${DATASET} with ${examples.length} examples`);
}

async function runEvaluation(): Promise<void> {
  const results = await evaluate(
    // One file per call; production batches 20, but the classification prompt
    // takes a list of any length, so the per-file message is identical.
    async (input: ClassifyInput) => {
      const labels = await labelFiles([input]);
      const role = labels.get(input.path);
      if (role === undefined) throw new Error(`No label returned for ${input.path}`);
      return { role };
    },
    {
      data: DATASET,
      experimentPrefix: `roles-classification-v${PROMPT_VERSIONS.classification}`,
      maxConcurrency: 4,
      client,
      evaluators: [
        ({ outputs, referenceOutputs }: { outputs?: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => ({
          key: "role_correct",
          score: outputs?.role === referenceOutputs?.role ? 1 : 0,
        }),
      ],
    },
  );

  let correct = 0;
  let total = 0;
  const perRole = new Map<string, { correct: number; total: number }>();
  const misses: string[] = [];
  for (const row of results.results) {
    const expected = row.example.outputs?.role;
    const got = row.run.outputs?.role;
    const path = row.example.inputs?.path;
    total += 1;
    const bucket = perRole.get(String(expected)) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (got === expected) {
      correct += 1;
      bucket.correct += 1;
    } else {
      misses.push(`${String(path)}: ${String(expected)} → ${String(got)}`);
    }
    perRole.set(String(expected), bucket);
  }

  console.log(`\n${results.experimentName}`);
  console.log(`accuracy: ${correct}/${total} = ${total === 0 ? 0 : ((correct / total) * 100).toFixed(1)}%`);
  for (const [role, bucket] of [...perRole.entries()].sort()) {
    console.log(`  ${role}: ${bucket.correct}/${bucket.total}`);
  }
  if (misses.length > 0) {
    console.log("misses:");
    for (const miss of misses) console.log(`  ${miss}`);
  }
  await flushTraces();
}

const args = process.argv.slice(2);
if (args[0] === "dataset") {
  const urls = args.slice(1);
  if (urls.length === 0) {
    console.error("Usage: npm run eval:roles -- dataset <github-url>...");
    process.exit(1);
  }
  await buildDataset(urls);
} else {
  await runEvaluation();
}
