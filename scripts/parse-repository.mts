import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRepository } from "../lib/parser/index.ts";
import { printParseReport } from "../lib/parser/print.ts";

function usage(): never {
  console.error("Usage: node --experimental-strip-types scripts/parse-repository.mts <directory> [--out <file>]");
  process.exit(1);
}

function outputPath(args: string[]): string | undefined {
  const index = args.indexOf("--out");
  return index === -1 ? undefined : args[index + 1];
}

const args = process.argv.slice(2);
const repository = args.find((arg) => !arg.startsWith("--"));
if (!repository) usage();

const result = await parseRepository(repository);
printParseReport({ summary: result.summary, edgeCount: result.edges.length, coverage: result.coverage, skipped: result.skipped });

const destination = outputPath(args);
if (destination) {
  const absoluteDestination = path.resolve(destination);
  await mkdir(path.dirname(absoluteDestination), { recursive: true });
  await writeFile(absoluteDestination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Wrote: ${absoluteDestination}`);
}
