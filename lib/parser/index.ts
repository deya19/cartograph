import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { detectAdapter, type ParserAdapter, type ProjectContext } from "./adapters/index.ts";
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
  // Set when the reference is counted but never resolved — a require() call in
  // a file that declares its own `require` binding.
  reason?: string;
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

function bindingNamesRequire(name: ts.BindingName | undefined): boolean {
  if (!name) return false;
  if (ts.isIdentifier(name)) return name.text === "require";
  return name.elements.some((element) => ts.isBindingElement(element) && bindingNamesRequire(element.name));
}

// A file that binds its own `require` (variable, function, parameter, import)
// isn't calling CommonJS require, so its calls are counted as unresolved
// rather than resolved as module references.
function declaresRequire(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && bindingNamesRequire(node.name)) {
      found = true;
      return;
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) && node.name?.text === "require") {
      found = true;
      return;
    }
    if ((ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) && node.name.text === "require") {
      found = true;
      return;
    }
    if (ts.isImportClause(node) && node.name?.text === "require") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function collectRequires(sourceFile: ts.SourceFile): ImportReference[] {
  const redefined = declaresRequire(sourceFile);
  const references: ImportReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      // import x = require("./a") is a module reference even in a file that
      // redefines `require` — the shadowing rule only covers call expressions.
      if (ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression)) {
        references.push({ specifier: reference.expression.text, kind: "require" });
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (ts.isStringLiteral(argument)) {
        references.push({ specifier: argument.text, kind: "require", ...(redefined ? { reason: "require is redefined in this file" } : {}) });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

// `exports.x` and `module.exports.x` — also `module.exports` itself.
function isExportsAccess(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && expression.text === "exports") ||
    (ts.isPropertyAccessExpression(expression) && expression.name.text === "exports" && ts.isIdentifier(expression.expression) && expression.expression.text === "module")
  );
}

function isModuleExports(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "exports" && ts.isIdentifier(expression.expression) && expression.expression.text === "module";
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

// A spread or computed key means the export list can't be recovered exactly —
// none of that object's names are recorded.
function objectLiteralExportNames(expression: ts.ObjectLiteralExpression): string[] | undefined {
  const names: string[] = [];
  for (const property of expression.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.push(property.name.text);
    } else if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
      const name = propertyNameText(property.name);
      if (name === undefined) return undefined;
      names.push(name);
    } else {
      return undefined;
    }
  }
  return names;
}

// Top-level statements only: exports.foo = …, exports["foo"] = …,
// module.exports.foo = …, module.exports["foo"] = …, module.exports = {…},
// and module.exports = <anything else> which exports a single default.
function collectCommonjsExports(sourceFile: ts.SourceFile): string[] | undefined {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const left = expression.left;
    if (ts.isPropertyAccessExpression(left) && isExportsAccess(left.expression)) {
      names.add(left.name.text);
    } else if (ts.isElementAccessExpression(left) && isExportsAccess(left.expression) && ts.isStringLiteral(left.argumentExpression)) {
      names.add(left.argumentExpression.text);
    } else if (isModuleExports(left)) {
      const right = expression.right;
      if (ts.isObjectLiteralExpression(right)) {
        const objectNames = objectLiteralExportNames(right);
        if (objectNames !== undefined) for (const name of objectNames) names.add(name);
      } else {
        names.add("default");
      }
    }
  }
  return names.size === 0 ? undefined : [...names].sort();
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
  // Adapters read files the parser never parses (package.json, configs), so
  // the context hands them a read limited to paths the walk actually saw.
  const context: ProjectContext = {
    allPaths,
    readText: (relativePath) => (allPaths.has(relativePath) ? readFileSync(path.join(root, relativePath), "utf8") : undefined),
  };
  const resolvedAdapter = adapter ?? detectAdapter(context);
  const entries = candidates.filter(({ relativePath }) => {
    const include = resolvedAdapter.shouldInclude(relativePath);
    if (!include) skipped.push({ path: relativePath, reason: "excluded by parser adapter" });
    return include;
  });
  return { root, adapter: resolvedAdapter, entries, skipped, allPaths, context };
}

export async function parseSelection(selection: Selection): Promise<ParseResult> {
  const { root, adapter: resolvedAdapter, entries, skipped, context } = selection;
  const run = resolvedAdapter.start(context);
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
      require: { found: 0, resolved: 0 },
    },
    examples: [],
  };

  for (const entry of entries) {
    const content = await readFile(entry.absolutePath, "utf8");
    const relativePath = entry.relativePath;
    const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true);
    const commonjsExports = collectCommonjsExports(sourceFile);
    files.push({
      path: relativePath,
      directory: normalize(path.dirname(relativePath)) === "." ? "." : normalize(path.dirname(relativePath)),
      module: resolvedAdapter.moduleName(relativePath),
      role: run.inspect(relativePath, sourceFile),
      extension: path.extname(relativePath),
      lines: lineCount(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      ...(commonjsExports === undefined ? {} : { commonjsExports }),
    });

    // Requires are collected in a second pass so existing import edges keep
    // their order; each kind dedupes separately.
    for (const reference of [...collectImports(sourceFile), ...collectRequires(sourceFile)]) {
      const resolution = reference.reason !== undefined ? { status: "unresolved" as const, reason: reference.reason } : await resolveFile(reference.specifier, entry.absolutePath, root, included, aliases);
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

  const routes = run.routes().sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.file.localeCompare(right.file));

  return {
    root,
    adapter: resolvedAdapter.name,
    files,
    edges,
    routes,
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

export type { ParserAdapter } from "./adapters/index.ts";
export type * from "./types.ts";
