export type EdgeKind = "import" | "re-export" | "dynamic-import";

export type CoverageStatus = "resolved" | "outside" | "excluded" | "unresolved";

export type FileRole = "page" | "layout" | "route" | "middleware" | "framework file" | "config" | "test";

export type FileRecord = {
  path: string;
  directory: string;
  module: string;
  extension: string;
  lines: number;
  sha256: string;
  role: FileRole | null;
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
  kindCounts: Record<EdgeKind, { found: number; resolved: number }>;
  examples: CoverageExample[];
};

export type FileMetrics = {
  fanIn: number;
  fanOut: number;
};

export type ParseResult = {
  root: string;
  adapter: string;
  files: FileRecord[];
  edges: Edge[];
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
