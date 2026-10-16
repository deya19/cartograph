import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRepository } from "../lib/parser/index.ts";
import type { ParseResult } from "../lib/parser/types.ts";

function usage(): never {
  console.error("Usage: node --experimental-strip-types scripts/parse-repository.mts <directory> [--out <file>]");
  process.exit(1);
}

function outputPath(args: string[]): string | undefined {
  const index = args.indexOf("--out");
  return index === -1 ? undefined : args[index + 1];
}

function print(result: ParseResult): void {
  console.log(`Files found: ${result.summary.filesFound}`);
  console.log(`Files parsed: ${result.summary.filesParsed}`);
  console.log(`Files skipped: ${result.summary.filesSkipped}`);
  console.log(`Folders: ${result.summary.folders}`);
  console.log(`Edges: ${result.edges.length}`);
  console.log(`Imports: ${result.coverage.total} (${result.coverage.resolved} resolved, ${result.coverage.outside} outside, ${result.coverage.excluded} excluded, ${result.coverage.unresolved} unresolved)`);
  for (const kind of ["import", "re-export", "dynamic-import"] as const) {
    const counts = result.coverage.kindCounts[kind];
    console.log(`${kind}: ${counts.found} found, ${counts.resolved} resolved`);
  }
  if (result.skipped.length > 0) {
    console.log("Skipped files:");
    for (const skipped of result.skipped) console.log(`  ${skipped.path}: ${skipped.reason}`);
  }
  if (result.coverage.examples.length > 0) {
    console.log("Coverage examples:");
    for (const example of result.coverage.examples) console.log(`  ${example.from} -> ${example.specifier} [${example.kind}]: ${example.status}${example.reason ? ` (${example.reason})` : ""}`);
  }
}

const args = process.argv.slice(2);
const repository = args.find((arg) => !arg.startsWith("--"));
if (!repository) usage();

const result = await parseRepository(repository);
print(result);

const destination = outputPath(args);
if (destination) {
  const absoluteDestination = path.resolve(destination);
  await mkdir(path.dirname(absoluteDestination), { recursive: true });
  await writeFile(absoluteDestination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Wrote: ${absoluteDestination}`);
}
