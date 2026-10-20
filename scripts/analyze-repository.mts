import { existsSync } from "node:fs";
import { runAnalysis, startAnalysis } from "../lib/pipeline/index.ts";
import { printParseReport } from "../lib/parser/print.ts";

function usage(): never {
  console.error("Usage: npm run analyze -- <github-url> --org <organization_id>");
  process.exit(1);
}

const args = process.argv.slice(2);
const url = args.find((arg) => !arg.startsWith("--"));
const orgIndex = args.indexOf("--org");
const organizationId = orgIndex === -1 ? undefined : args[orgIndex + 1];
if (!url || !organizationId) usage();

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { analysisId, existing } = await startAnalysis(organizationId, url);
if (existing) {
  // Re-running is deliberate, not re-pasting the URL — the analysis row is
  // found, not reset.
  console.log(`Already analysed: ${analysisId}`);
  process.exit(0);
}

console.log(`Analysis: ${analysisId}`);
const result = await runAnalysis(analysisId, (stage, message) => console.log(`[${stage}] ${message}`));
printParseReport({ adapter: result.adapter, summary: result.summary, edgeCount: result.edges.length, routes: result.routes, coverage: result.coverage, commonjsExportsFiles: result.files.filter((file) => file.commonjsExports !== undefined).length, skipped: result.skipped });
