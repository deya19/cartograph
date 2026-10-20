import type { ParserAdapter, ProjectContext } from "./adapters/index.ts";
import type { FileRole, RouteMethod } from "../roles.ts";

export type { FileRole, RouteMethod } from "../roles.ts";

export type Route = { file: string; method: RouteMethod; path: string };

export type EdgeKind = "import" | "re-export" | "dynamic-import" | "require";

export type CoverageStatus = "resolved" | "outside" | "excluded" | "unresolved";

export type FileRecord = {
  path: string;
  directory: string;
  module: string;
  extension: string;
  lines: number;
  sha256: string;
  role: FileRole | null;
  // Present only when the file has at least one recoverable CommonJS export —
  // ESM output keeps its shape.
  commonjsExports?: string[];
};

export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
};

export type CoverageExample = {
  from: string;
  specifier: string;
  kind: EdgeKind;
  status: CoverageStatus;
  reason?: string;
};

export type Coverage = {
  total: number;
  resolved: number;
  outside: number;
  excluded: number;
  unresolved: number;
  // Analyses stored before the "require" kind existed may omit that key;
  // readers treat a missing entry as { found: 0, resolved: 0 }.
  kindCounts: Record<EdgeKind, { found: number; resolved: number }>;
  examples: CoverageExample[];
};

export type FileMetrics = {
  fanIn: number;
  fanOut: number;
};

export type Selection = {
  root: string;
  adapter: ParserAdapter;
  entries: Array<{ absolutePath: string; relativePath: string }>;
  skipped: Array<{ path: string; reason: string }>;
  allPaths: ReadonlySet<string>;
  context: ProjectContext;
};

export type ParseResult = {
  root: string;
  adapter: string;
  files: FileRecord[];
  edges: Edge[];
  routes: Route[];
  metrics: Record<string, FileMetrics>;
  coverage: Coverage;
  skipped: Array<{ path: string; reason: string }>;
  summary: {
    filesFound: number;
    filesParsed: number;
    filesSkipped: number;
    folders: number;
  };
};
