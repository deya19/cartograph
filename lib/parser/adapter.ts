import type { FileRecord, FileRole } from "./types";

export type ParserAdapter = {
  name: string;
  isEntryPoint(filePath: string): boolean;
  shouldInclude(filePath: string): boolean;
  moduleName(filePath: string): string;
  role(filePath: string, allPaths: ReadonlySet<string>): FileRole | null;
};

const configFile = /^[^/]+\.config\.(?:c|m)?[jt]sx?$/;

function fallbackRole(filePath: string, allPaths: ReadonlySet<string>): FileRole | null {
  const segments = filePath.split("/");
  const base = segments.at(-1) ?? filePath;
  if (base.includes(".test.") || base.includes(".spec.") || segments.includes("__tests__")) return "test";
  if (configFile.test(base)) {
    const directory = segments.slice(0, -1).join("/");
    // A config file only counts at a package boundary — repo root or a
    // directory holding package.json — so package-internal files like
    // packages/docs/app/layout.config.tsx stay unidentified.
    if (directory === "" || allPaths.has(`${directory}/package.json`)) return "config";
  }
  return null;
}

export const fallbackAdapter: ParserAdapter = {
  name: "fallback",
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  role: fallbackRole,
};

const nextConfigFile = /(?:^|\/)next\.config\.(?:js|mjs|cjs|ts|mts)$/;

// Next reaches these files itself, so the import graph never shows them as
// used; the role is what keeps them out of the nothing-imports insight.
const nextFrameworkFiles = new Set([
  "loading",
  "error",
  "global-error",
  "not-found",
  "default",
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
  "sitemap",
  "robots",
  "manifest",
]);

// Project roots depend only on allPaths, which the parser rebuilds per run, so
// a WeakMap keyed on that set caches them without leaking between runs.
const nextRootCache = new WeakMap<ReadonlySet<string>, string[]>();

function nextProjectRoots(allPaths: ReadonlySet<string>): string[] {
  const cached = nextRootCache.get(allPaths);
  if (cached) return cached;
  const roots = new Set<string>();
  for (const path of allPaths) {
    if (nextConfigFile.test(path)) {
      const index = path.lastIndexOf("/");
      roots.add(index === -1 ? "." : path.slice(0, index));
    }
  }
  // Longest first: a nested project claims its own files before a parent can.
  const sorted = [...roots].sort((left, right) => right.length - left.length);
  nextRootCache.set(allPaths, sorted);
  return sorted;
}

function nextRole(filePath: string, allPaths: ReadonlySet<string>): FileRole | null {
  for (const root of nextProjectRoots(allPaths)) {
    const prefix = root === "." ? "" : `${root}/`;
    if (!filePath.startsWith(prefix)) continue;
    const rest = filePath.slice(prefix.length);
    const stem = rest.replace(/\.(?:c|m)?[jt]sx?$/, "");
    const base = stem.split("/").at(-1) ?? stem;

    if (rest.startsWith("app/") || rest.startsWith("src/app/")) {
      if (base === "page") return "page";
      if (base === "layout" || base === "template") return "layout";
      if (base === "route") return "route";
      if (nextFrameworkFiles.has(base)) return "framework file";
    } else if (rest.startsWith("pages/") || rest.startsWith("src/pages/")) {
      return rest.startsWith("pages/api/") || rest.startsWith("src/pages/api/") ? "route" : "page";
    } else {
      const directory = stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "";
      if (directory === "" || directory === "src") {
        if (base === "middleware" || base === "proxy") return "middleware";
        if (base === "instrumentation" || base === "instrumentation-client") return "framework file";
      }
    }
    break;
  }
  return fallbackRole(filePath, allPaths);
}

export const nextAdapter: ParserAdapter = {
  name: "next",
  isEntryPoint: fallbackAdapter.isEntryPoint,
  shouldInclude: fallbackAdapter.shouldInclude,
  moduleName: fallbackAdapter.moduleName,
  role: nextRole,
};

export function detectAdapter(allPaths: ReadonlySet<string>): ParserAdapter {
  // The Next config marks whichever package is the app — in a monorepo like
  // Zod's that's packages/docs — so a config anywhere picks the adapter.
  for (const path of allPaths) {
    if (nextConfigFile.test(path)) return nextAdapter;
  }
  return fallbackAdapter;
}

export function moduleForFile(file: FileRecord): string {
  return file.module;
}
