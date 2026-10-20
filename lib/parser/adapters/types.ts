import type ts from "typescript";
import type { AdapterName, FileRole } from "../../roles.ts";
import type { Route } from "../types.ts";

// Everything an adapter may know about the repository: the full file list,
// and a way to read files the parser never parses (package.json, configs).
export type ProjectContext = {
  allPaths: ReadonlySet<string>;
  readText(path: string): string | undefined;
};

export type AdapterRun = {
  // Called once per parsed file; may record route candidates for routes().
  inspect(filePath: string, source: ts.SourceFile): FileRole | null;
  // Called after every file was inspected.
  routes(): Route[];
};

export type ParserAdapter = {
  name: AdapterName;
  detect(context: ProjectContext): boolean;
  isEntryPoint(filePath: string): boolean;
  shouldInclude(filePath: string): boolean;
  moduleName(filePath: string): string;
  // Per-run state lives in the closure this returns.
  start(context: ProjectContext): AdapterRun;
};
