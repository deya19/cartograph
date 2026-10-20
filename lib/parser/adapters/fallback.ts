import type { FileRole } from "../../roles.ts";
import type { ParserAdapter, ProjectContext } from "./types.ts";

const configFile = /^[^/]+\.config\.(?:c|m)?[jt]sx?$/;

export function fallbackRole(filePath: string, allPaths: ReadonlySet<string>): FileRole | null {
  const segments = filePath.split("/");
  const base = segments.at(-1) ?? filePath;
  // .e2e-spec is the Nest convention and doesn't match the .spec check.
  if (base.includes(".test.") || base.includes(".spec.") || base.includes(".e2e-spec.") || segments.includes("__tests__")) return "test";
  if (configFile.test(base)) {
    const directory = segments.slice(0, -1).join("/");
    // A config file only counts at a package boundary — repo root or a
    // directory holding package.json — so package-internal files like
    // packages/docs/app/layout.config.tsx stay unidentified.
    if (directory === "" || allPaths.has(`${directory}/package.json`)) return "config";
  }
  return null;
}

export function manifestDependsOn(text: string, pkg: string): boolean {
  try {
    const manifest: unknown = JSON.parse(text);
    if (typeof manifest !== "object" || manifest === null) return false;
    const declares = (value: unknown): boolean => typeof value === "object" && value !== null && pkg in value;
    if ("dependencies" in manifest && declares(manifest.dependencies)) return true;
    return "devDependencies" in manifest && declares(manifest.devDependencies);
  } catch {
    return false;
  }
}

// Every package.json in the tree is checked, so a monorepo package declaring
// the dependency counts even when the root manifest doesn't.
export function dependsOn(context: ProjectContext, pkg: string): boolean {
  for (const path of context.allPaths) {
    if (path.split("/").at(-1) !== "package.json") continue;
    const text = context.readText(path);
    if (text !== undefined && manifestDependsOn(text, pkg)) return true;
  }
  return false;
}

export const fallbackAdapter: ParserAdapter = {
  name: "fallback",
  detect: () => true,
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  start: (context) => ({
    inspect: (filePath) => fallbackRole(filePath, context.allPaths),
    routes: () => [],
  }),
};
