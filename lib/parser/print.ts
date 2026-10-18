import type { Coverage, ParseResult } from "./types.ts";

export type ParseReport = {
  summary: ParseResult["summary"];
  edgeCount: number;
  coverage: Coverage;
  skipped: Array<{ path: string; reason: string }>;
};

export function printParseReport(report: ParseReport): void {
  console.log(`Files found: ${report.summary.filesFound}`);
  console.log(`Files parsed: ${report.summary.filesParsed}`);
  console.log(`Files skipped: ${report.summary.filesSkipped}`);
  console.log(`Folders: ${report.summary.folders}`);
  console.log(`Edges: ${report.edgeCount}`);
  console.log(`Imports: ${report.coverage.total} (${report.coverage.resolved} resolved, ${report.coverage.outside} outside, ${report.coverage.excluded} excluded, ${report.coverage.unresolved} unresolved)`);
  for (const kind of ["import", "re-export", "dynamic-import"] as const) {
    const counts = report.coverage.kindCounts[kind];
    console.log(`${kind}: ${counts.found} found, ${counts.resolved} resolved`);
  }
  if (report.skipped.length > 0) {
    console.log("Skipped files:");
    for (const skipped of report.skipped) console.log(`  ${skipped.path}: ${skipped.reason}`);
  }
  if (report.coverage.examples.length > 0) {
    console.log("Coverage examples:");
    for (const example of report.coverage.examples) console.log(`  ${example.from} -> ${example.specifier} [${example.kind}]: ${example.status}${example.reason ? ` (${example.reason})` : ""}`);
  }
}
