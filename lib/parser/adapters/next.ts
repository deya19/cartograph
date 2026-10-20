import ts from "typescript";
import type { FileRole } from "../../roles.ts";
import type { Route } from "../types.ts";
import { dependsOn, fallbackRole, manifestDependsOn } from "./fallback.ts";
import { reactRole } from "./react.ts";
import type { ParserAdapter, ProjectContext } from "./types.ts";

const nextConfigFile = /(?:^|\/)next\.config\.(?:js|mjs|cjs|ts|mts)$/;
const nextConfigExtensions = ["js", "mjs", "cjs", "ts", "mts"];

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

type RouteVerb = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";

function isRouteVerb(name: string): name is RouteVerb {
  return name === "GET" || name === "HEAD" || name === "POST" || name === "PUT" || name === "DELETE" || name === "PATCH" || name === "OPTIONS";
}

// Project roots depend only on the context, which the parser rebuilds per
// run, so a WeakMap keyed on it caches them without leaking between runs.
const rootCache = new WeakMap<ProjectContext, string[]>();

function projectRoots(context: ProjectContext): string[] {
  const cached = rootCache.get(context);
  if (cached) return cached;
  const roots = new Set<string>();
  for (const path of context.allPaths) {
    const base = path.split("/").at(-1) ?? path;
    const isConfig = nextConfigFile.test(path);
    const isManifest = base === "package.json";
    if (!isConfig && !isManifest) continue;
    if (isManifest && !manifestDependsOn(context.readText(path) ?? "", "next")) continue;
    const index = path.lastIndexOf("/");
    roots.add(index === -1 ? "." : path.slice(0, index));
  }
  // Longest first: a nested project claims its own files before a parent can.
  const sorted = [...roots].sort((left, right) => right.length - left.length);
  rootCache.set(context, sorted);
  return sorted;
}

function hasUseServerDirective(source: ts.SourceFile): boolean {
  // The directive prologue is the run of string-literal statements a file may
  // start with; anything else ends it.
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function exportedVerbNames(source: ts.SourceFile): Set<RouteVerb> {
  const verbs = new Set<RouteVerb>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const exported = ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (exported && statement.name && isRouteVerb(statement.name.text)) verbs.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      const exported = ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!exported) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isRouteVerb(declaration.name.text)) verbs.add(declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      // Covers both `export { handler as GET }` and `export { GET } from "./x"`.
      for (const specifier of statement.exportClause.elements) {
        if (isRouteVerb(specifier.name.text)) verbs.add(specifier.name.text);
      }
    }
  }
  return verbs;
}

// basePath, i18n and pageExtensions each change the real URL or which files
// are pages, and none can be recovered exactly — so a root whose config uses
// them emits no routes at all rather than approximate ones.
function routesSuppressed(context: ProjectContext, root: string): boolean {
  const prefix = root === "." ? "" : `${root}/`;
  for (const extension of nextConfigExtensions) {
    const text = context.readText(`${prefix}next.config.${extension}`);
    if (text !== undefined && (text.includes("basePath") || text.includes("i18n") || text.includes("pageExtensions"))) return true;
  }
  return false;
}

// Route groups "(name)" don't appear in the URL; private folders, parallel
// slots and intercepting segments mean the file isn't reachable by a plain
// path, so the file yields no route.
function appRoutePath(dirSegments: string[]): string | null {
  const kept: string[] = [];
  for (const segment of dirSegments) {
    if (segment.startsWith("_") || segment.startsWith("@")) return null;
    if (segment.startsWith("(") && segment[1] === ".") return null;
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    kept.push(segment);
  }
  return kept.length === 0 ? "/" : `/${kept.join("/")}`;
}

export const nextAdapter: ParserAdapter = {
  name: "nextjs",
  // The Next config marks whichever package is the app — in a monorepo like
  // Zod's that's packages/docs — so a config anywhere picks the adapter.
  detect: (context) => {
    for (const path of context.allPaths) {
      if (nextConfigFile.test(path)) return true;
    }
    return dependsOn(context, "next");
  },
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  start: (context) => {
    const routes: Route[] = [];
    const suppression = new Map<string, boolean>();
    const suppressed = (root: string): boolean => {
      const cached = suppression.get(root);
      if (cached !== undefined) return cached;
      const value = routesSuppressed(context, root);
      suppression.set(root, value);
      return value;
    };

    const inspect = (filePath: string, source: ts.SourceFile): FileRole | null => {
      for (const root of projectRoots(context)) {
        const prefix = root === "." ? "" : `${root}/`;
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const stem = rest.replace(/\.(?:c|m)?[jt]sx?$/, "");
        const base = stem.split("/").at(-1) ?? stem;

        const appMatch = rest.startsWith("app/") ? 1 : rest.startsWith("src/app/") ? 2 : 0;
        const pagesMatch = rest.startsWith("pages/") ? 1 : rest.startsWith("src/pages/") ? 2 : 0;

        if (appMatch > 0) {
          const dirSegments = stem.split("/").slice(appMatch, -1);
          if (base === "page") {
            if (!suppressed(root)) {
              const routePath = appRoutePath(dirSegments);
              if (routePath !== null) routes.push({ file: filePath, method: "PAGE", path: routePath });
            }
            return "page";
          }
          if (base === "layout" || base === "template") return "layout";
          if (base === "route") {
            // The method isn't in the file's position, it's in which handlers
            // the file exports — one route per exported verb.
            if (!suppressed(root)) {
              const routePath = appRoutePath(dirSegments);
              if (routePath !== null) {
                for (const verb of exportedVerbNames(source)) routes.push({ file: filePath, method: verb, path: routePath });
              }
            }
            return "route";
          }
          if (nextFrameworkFiles.has(base)) return "framework file";
        } else if (pagesMatch > 0) {
          const segments = stem.split("/").slice(pagesMatch);
          const leaf = segments.at(-1) ?? "";
          if (segments.length === 1 && (leaf === "_app" || leaf === "_document" || leaf === "_error")) return "framework file";
          if (rest.startsWith("pages/api/") || rest.startsWith("src/pages/api/")) {
            // A pages/api handler picks its methods inside the function, which
            // the syntax doesn't carry — so no route, not a guessed one.
            return "route";
          }
          if (!suppressed(root) && !(segments.length === 1 && (leaf === "404" || leaf === "500"))) {
            const kept = leaf === "index" ? segments.slice(0, -1) : segments;
            routes.push({ file: filePath, method: "PAGE", path: kept.length === 0 ? "/" : `/${kept.join("/")}` });
          }
          return "page";
        } else {
          const directory = stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "";
          if (directory === "" || directory === "src") {
            if (base === "middleware" || base === "proxy") return "middleware";
            if (base === "instrumentation" || base === "instrumentation-client") return "framework file";
          }
        }
        break;
      }
      // Path conventions first, then test/config, then directives, then
      // React — a Button.test.tsx is a test, not a component.
      return fallbackRole(filePath, context.allPaths) ?? (hasUseServerDirective(source) ? "server action" : null) ?? reactRole(filePath, source);
    };

    return { inspect, routes: () => routes };
  },
};

