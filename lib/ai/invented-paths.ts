import { posix } from "node:path";

// Rebuilds the exact set of paths a prompt was shown, from a run's recorded
// trace inputs — the same object that was handed to the traced call. The
// lists in the inputs are the lists in the prompt verbatim (the folder
// prompt's truncation applies to both identically in explain.ts), so anything
// path-shaped in the answer that is not in this set was invented.

type ExplainFileInputs = {
  path: string;
  imports: Array<{ path: string }>;
  importedBy: Array<{ path: string }>;
};

type ExplainFolderInputs = {
  folder: string;
  files: Array<{ path: string }>;
  importedFrom: Array<{ target: string; importers: string[] }>;
  importsOutside: Array<{ path: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


function requirePathArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Malformed run inputs: ${field} is not an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new Error(`Malformed run inputs: ${field}[${index}] has no string path`);
    }
    return entry.path;
  });
}

function isExplainFileInputs(inputs: Record<string, unknown>): inputs is Record<string, unknown> & ExplainFileInputs {
  return (
    typeof inputs.path === "string" &&
    Array.isArray(inputs.imports) &&
    inputs.imports.every((entry) => isRecord(entry) && typeof entry.path === "string") &&
    Array.isArray(inputs.importedBy) &&
    inputs.importedBy.every((entry) => isRecord(entry) && typeof entry.path === "string")
  );
}

function isExplainFolderInputs(inputs: Record<string, unknown>): inputs is Record<string, unknown> & ExplainFolderInputs {
  return (
    typeof inputs.folder === "string" &&
    Array.isArray(inputs.files) &&
    inputs.files.every((entry) => isRecord(entry) && typeof entry.path === "string") &&
    Array.isArray(inputs.importedFrom) &&
    inputs.importedFrom.every(
      (entry) => isRecord(entry) && typeof entry.target === "string" && Array.isArray(entry.importers) && entry.importers.every((importer) => typeof importer === "string"),
    ) &&
    Array.isArray(inputs.importsOutside) &&
    inputs.importsOutside.every((entry) => isRecord(entry) && typeof entry.path === "string")
  );
}

// base is the file's directory for explain-file (so "./x.ts" in prose can be
// resolved) and null for explain-folder, where "./" has no referent.
export function shownPaths(runName: string, inputs: unknown): { paths: Set<string>; base: string | null } {
  if (!isRecord(inputs)) throw new Error(`Malformed run inputs for ${runName}: not an object`);

  if (runName === "explain-file") {
    if (!isExplainFileInputs(inputs)) throw new Error("Malformed explain-file run inputs");
    return {
      paths: new Set([inputs.path, ...requirePathArray(inputs.imports, "imports"), ...requirePathArray(inputs.importedBy, "importedBy")]),
      base: posix.dirname(inputs.path),
    };
  }

  if (runName === "explain-folder") {
    if (!isExplainFolderInputs(inputs)) throw new Error("Malformed explain-folder run inputs");
    const paths = new Set<string>([inputs.folder]);
    for (const file of inputs.files) paths.add(file.path);
    for (const { target, importers } of inputs.importedFrom) {
      paths.add(target);
      for (const importer of importers) paths.add(importer);
    }
    for (const { path } of inputs.importsOutside) paths.add(path);
    return { paths, base: null };
  }

  throw new Error(`shownPaths does not know run name: ${runName}`);
}

const TOKEN = /[A-Za-z0-9_@.\-/[\]()]+/g;
const LEADING = /^[('"[<]/;
const TRAILING = /[.,;:)\]'">]$/;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

// Product names look exactly like paths to the extension test (Next.js,
// Node.js): capitalised single word ending ".js" with no slash.
const PRODUCT_NAME = /^[A-Z][A-Za-z]*\.js$/;

function isPathShaped(token: string): boolean {
  if (PRODUCT_NAME.test(token)) return false;
  if (token.includes("/")) return /[^./]/.test(token);
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  if (!SOURCE_EXTENSIONS.includes(token.slice(dot))) return false;
  // At least one non-dot character before the extension — ".ts" alone is not a path.
  return /[^.]/.test(token.slice(0, dot));
}

export type InventedPathsResult = { checked: string[]; invented: string[] };

// Tokens are cut and trimmed exactly as the renderer does
// (explanation-text.tsx): prose wraps paths in punctuation, so both ends are
// stripped — stopping early when the remainder already matches a shown path.
// Slash-containing paths are checked even without a source extension. A
// single-segment token still needs a known extension to distinguish it from
// ordinary prose.
export function findInventedPaths(text: string, shown: Set<string>, base: string | null): InventedPathsResult {
  const checked = new Set<string>();
  const invented = new Set<string>();

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    let start = 0;
    let end = token.length;
    while (end > start && !shown.has(token.slice(start, end))) {
      if (TRAILING.test(token.slice(start, end))) {
        end -= 1;
      } else if (LEADING.test(token.slice(start, end))) {
        start += 1;
      } else {
        break;
      }
    }
    const candidate = token.slice(start, end);
    if (candidate.length === 0 || shown.has(candidate)) continue;
    if (!isPathShaped(candidate)) continue;

    let probe = candidate;
    if ((candidate.startsWith("./") || candidate.startsWith("../")) && base !== null) {
      probe = posix.normalize(posix.join(base, candidate));
    }
    checked.add(candidate);
    if (!shown.has(probe)) invented.add(candidate);
  }

  return { checked: [...checked], invented: [...invented] };
}

export function scorePaths(result: InventedPathsResult): number {
  return result.invented.length === 0 ? 1 : 0;
}
