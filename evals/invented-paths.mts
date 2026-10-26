// Invented-path check over real traffic: recent explain-file/explain-folder
// runs from LangSmith, each explanation's path-shaped tokens tested against
// the paths its prompt actually showed.
//
//   npm run eval:paths                         score recent runs (default 50)
//   npm run eval:paths -- --limit 100
//   npm run eval:paths -- --splice lib/x.ts    splice a made-up path into each
//                                              explanation; all must be caught
import "../scripts/load-env.mts";
import { Client } from "langsmith";
import type { Run } from "langsmith/schemas";
import { tracingStatus } from "../lib/ai/client.ts";
import { findInventedPaths, shownPaths } from "../lib/ai/invented-paths.ts";

const DEFAULT_LIMIT = 50;

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const status = tracingStatus();
if (!status.enabled) {
  console.error(`Cannot list runs: ${status.reason}`);
  process.exit(1);
}

const limitArg = arg("--limit");
const limit = limitArg === undefined ? DEFAULT_LIMIT : Number(limitArg);
if (!Number.isInteger(limit) || limit <= 0) {
  console.error(`--limit must be a positive integer, got: ${limitArg}`);
  process.exit(1);
}
const splicePath = arg("--splice");

// After the first sentence — the made-up dependency has to read like the
// model wrote it, not like an appendix.
function splice(text: string, path: string): string {
  const sentence = ` It also depends on \`${path}\`.`;
  // First sentence end: a period followed by whitespace or end of text. A
  // bare "." can sit inside a path (lib/foo.ts) and would cut it in half.
  const end = /\.(\s|$)/.exec(text);
  return end === null ? text + sentence : `${text.slice(0, end.index + 1)}${sentence}${text.slice(end.index + 1)}`;
}

function textOf(run: Run): string | null {
  const outputs = run.outputs;
  if (typeof outputs !== "object" || outputs === null || !("text" in outputs) || typeof outputs.text !== "string") {
    return null;
  }
  return outputs.text;
}

function subjectOf(run: Run): string {
  const inputs = run.inputs;
  if (typeof inputs === "object" && inputs !== null) {
    if (typeof inputs.path === "string") return inputs.path;
    if (typeof inputs.folder === "string") return inputs.folder;
  }
  return "?";
}

const client = new Client();

const runs: Run[] = [];
for await (const run of client.listRuns({
  projectName: status.project,
  isRoot: true,
  filter: 'in(name, ["explain-file", "explain-folder"])',
  error: false,
  limit,
})) {
  runs.push(run);
}

if (runs.length === 0) {
  console.log(`No explain runs found in project "${status.project}"`);
  process.exit(0);
}

let checked = 0;
let clean = 0;
let withoutText = 0;
let caught = 0;

for (const run of runs) {
  const text = textOf(run);
  if (text === null) {
    withoutText += 1;
    continue;
  }
  const { paths, base } = shownPaths(run.name, run.inputs);
  const subject = subjectOf(run);

  if (splicePath !== undefined) {
    const result = findInventedPaths(splice(text, splicePath), paths, base);
    const wasCaught = result.invented.includes(splicePath);
    if (wasCaught) caught += 1;
    console.log(`${wasCaught ? "caught" : "MISSED"} ${run.name} ${subject} ${run.id}${wasCaught ? "" : ` — spliced ${splicePath} not flagged (invented: ${result.invented.join(", ") || "none"})`}`);
    continue;
  }

  checked += 1;
  const result = findInventedPaths(text, paths, base);
  if (result.invented.length === 0) {
    clean += 1;
    console.log(`ok       ${run.name} ${subject} ${run.id}`);
  } else {
    console.log(`INVENTED ${run.name} ${subject} ${run.id}`);
    console.log(`         invented: ${result.invented.join(", ")}`);
    console.log(`         shown:    ${[...paths].join(", ")}`);
  }
}

if (splicePath !== undefined) {
  const total = runs.length - withoutText;
  console.log(`\nsplice \`${splicePath}\`: caught ${caught}/${total}${withoutText > 0 ? ` (${withoutText} run(s) had no text output)` : ""}`);
  if (caught < total) process.exit(1);
} else {
  console.log(`\nclean ${clean}/${checked} = ${checked === 0 ? "0" : ((clean / checked) * 100).toFixed(1)}%${withoutText > 0 ? ` (${withoutText} run(s) skipped: no text output)` : ""}`);
}
