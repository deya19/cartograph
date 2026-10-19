import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { detectAdapter, type ParserAdapter } from "./adapter.ts";
import type {
  Coverage,
  CoverageExample,
  Edge,
  EdgeKind,
  FileMetrics,
  FileRecord,
  ParseResult,
  Selection,
} from "./types.ts";

const ignoredDirectories = new Set([".git", ".next", "node_modules", "dist", "build", "coverage"]);
const supportedFile = /\.(?:c|m)?[jt]sx?$/;
const maxExamples = 100;

type ImportReference = {
  specifier: string;
  kind: EdgeKind;
};

type FileEntry = {
  absolutePath: string;
  relativePath: string;
};

function normalize(value: string): string {
  return value.split(path.sep).join("/");
}

function relativeToRoot(root: string, value: string): string {
  return normalize(path.relative(root, value));
}

function isWithin(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function walk(root: string, current: string, skipped: Array<{ path: string; reason: string }>, allPaths: Set<string>): Promise<FileEntry[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: FileEntry[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = relativeToRoot(root, absolutePath);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        skipped.push({ path: relativePath, reason: `excluded directory: ${entry.name}` });
        continue;
      }
      files.push(...(await walk(root, absolutePath, skipped, allPaths)));
      continue;
    }

    if (!entry.isFile()) {
      skipped.push({ path: relativePath, reason: "not a regular file" });
      continue;
    }

    // Every regular file goes to allPaths — convention checks like "directory
    // contains package.json" or "next.config exists" need files this parser
    // will never parse.
    allPaths.add(relativePath);
    if (supportedFile.test(entry.name)) {
      files.push({ absolutePath, relativePath });
    } else {
      skipped.push({ path: relativePath, reason: "unsupported file type" });
    }
  }

  return files;
}

function lineCount(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length;
}

function collectImports(sourceFile: ts.SourceFile): ImportReference[] {
  const references: ImportReference[] = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ specifier: node.moduleSpecifier.text, kind: "import" });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ specifier: node.moduleSpecifier.text, kind: "re-export" });
    }
  });

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        references.push({ specifier: argument.text, kind: "dynamic-import" });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function candidates(filePath: string): string[] {
  const extension = path.extname(filePath);
  const withoutExtension = extension ? filePath.slice(0, -extension.length) : filePath;
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
  return [filePath, ...extensions.map((item) => `${withoutExtension}${item}`), ...extensions.map((item) => path.join(filePath, `index${item}`))];
}

type PathAlias = {
  pattern: string;
  target: string;
};

function aliasTarget(specifier: string, aliases: PathAlias[], root: string): string | undefined {
  for (const alias of aliases) {
    const wildcardIndex = alias.pattern.indexOf("*");
    if (wildcardIndex === -1) {
      if (specifier === alias.pattern) return path.resolve(root, alias.target);
      continue;
    }

    const prefix = alias.pattern.slice(0, wildcardIndex);
    const suffix = alias.pattern.slice(wildcardIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
    return path.resolve(root, alias.target.replace("*", middle));
  }
  return undefined;
}

async function resolveFile(specifier: string, fromFile: string, root: string, included: Set<string>, aliases: PathAlias[]): Promise<{ status: "resolved" | "outside" | "excluded" | "unresolved"; target?: string; reason?: string }> {
  const aliased = aliasTarget(specifier, aliases, root);
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !aliased) {
    return { status: "outside", reason: "package or bare module specifier" };
  }

  const requested = aliased ?? path.resolve(path.dirname(fromFile), specifier);
  if (!isWithin(root, requested)) {
    return { status: "outside", reason: "path points outside the repository" };
  }

  for (const candidate of candidates(requested)) {
    try {
      const details = await stat(candidate);
      if (!details.isFile()) continue;
      const relative = relativeToRoot(root, candidate);
      if (included.has(relative)) return { status: "resolved", target: relative };
      return { status: "excluded", reason: "target exists but was excluded from the file set" };
    } catch {
      // A candidate that does not exist is expected during extension probing.
    }
  }

  return { status: "unresolved", reason: "no matching file or index module" };
}

function addCoverage(coverage: Coverage, example: CoverageExample): void {
  coverage.total += 1;
  coverage[example.status] += 1;
  coverage.kindCounts[example.kind].found += 1;
  if (coverage.examples.length < maxExamples) coverage.examples.push(example);
}

async function readPathAliases(root: string): Promise<PathAlias[]> {
  try {
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    if (config.error || !config.config.compilerOptions?.paths) return [];
    const baseUrl = config.config.compilerOptions.baseUrl ?? ".";
    return Object.entries(config.config.compilerOptions.paths as Record<string, string[]>).flatMap(([pattern, targets]) =>
      targets.map((target) => ({ pattern, target: path.join(baseUrl, target) })),
    );
  } catch {
    return [];
  }
}

export async function selectFiles(repositoryPath: string, adapter?: ParserAdapter): Promise<Selection> {
  const root = path.resolve(repositoryPath);
  const rootDetails = await stat(root);
  if (!rootDetails.isDirectory()) throw new Error(`Repository path is not a directory: ${repositoryPath}`);

  const skipped: Array<{ path: string; reason: string }> = [];
  const allPaths = new Set<string>();
  const candidates = await walk(root, root, skipped, allPaths);
  const resolvedAdapter = adapter ?? detectAdapter(allPaths);
  const entries = candidates.filter(({ relativePath }) => {
    const include = resolvedAdapter.shouldInclude(relativePath);
    if (!include) skipped.push({ path: relativePath, reason: "excluded by parser adapter" });
    return include;
  });
  return { root, adapter: resolvedAdapter, entries, skipped, allPaths };
}

export async function parseSelection(selection: Selection): Promise<ParseResult> {
  const { root, adapter: resolvedAdapter, entries, skipped, allPaths } = selection;
  const included = new Set(entries.map(({ relativePath }) => relativePath));
  const aliases = await readPathAliases(root);
  const files: FileRecord[] = [];
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const coverage: Coverage = {
    total: 0,
    resolved: 0,
    outside: 0,
    excluded: 0,
    unresolved: 0,
    kindCounts: {
      import: { found: 0, resolved: 0 },
      "re-export": { found: 0, resolved: 0 },
      "dynamic-import": { found: 0, resolved: 0 },
    },
    examples: [],
  };

  for (const entry of entries) {
    const content = await readFile(entry.absolutePath, "utf8");
    const relativePath = entry.relativePath;
    files.push({
      path: relativePath,
      directory: normalize(path.dirname(relativePath)) === "." ? "." : normalize(path.dirname(relativePath)),
      module: resolvedAdapter.moduleName(relativePath),
      role: resolvedAdapter.role(relativePath, allPaths),
      extension: path.extname(relativePath),
      lines: lineCount(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });

    const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true);
    for (const reference of collectImports(sourceFile)) {
      const resolution = await resolveFile(reference.specifier, entry.absolutePath, root, included, aliases);
      addCoverage(coverage, { from: relativePath, specifier: reference.specifier, kind: reference.kind, status: resolution.status, reason: resolution.reason });
      if (resolution.status === "resolved" && resolution.target) {
        coverage.kindCounts[reference.kind].resolved += 1;
        const key = `${relativePath}\0${resolution.target}\0${reference.kind}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ from: relativePath, to: resolution.target, kind: reference.kind });
        }
      }
    }
  }

  const metrics: Record<string, FileMetrics> = Object.fromEntries(files.map((file) => [file.path, { fanIn: 0, fanOut: 0 }]));
  for (const edge of edges) {
    metrics[edge.from].fanOut += 1;
    metrics[edge.to].fanIn += 1;
  }

  return {
    root,
    adapter: resolvedAdapter.name,
    files,
    edges,
    metrics,
    coverage,
    skipped,
    summary: {
      filesFound: entries.length + skipped.length,
      filesParsed: files.length,
      filesSkipped: skipped.length,
      folders: new Set(files.map((file) => file.directory)).size,
    },
  };
}

export async function parseRepository(repositoryPath: string, adapter?: ParserAdapter): Promise<ParseResult> {
  return parseSelection(await selectFiles(repositoryPath, adapter));
}

export type { ParserAdapter } from "./adapter.ts";
export type * from "./types.ts";
