import ts from "typescript";
import type { FileRole } from "../../roles.ts";
import type { Route, RouteMethod } from "../types.ts";
import { dependsOn, fallbackRole } from "./fallback.ts";
import type { ParserAdapter } from "./types.ts";

const nestRoles = new Map<string, FileRole>([
  ["controller", "controller"],
  ["resolver", "resolver"],
  ["gateway", "gateway"],
  ["service", "service"],
  ["repository", "repository"],
  ["entity", "entity"],
  ["dto", "dto"],
  ["module", "module"],
  ["guard", "guard"],
  ["interceptor", "interceptor"],
  ["pipe", "pipe"],
  ["filter", "filter"],
  ["middleware", "middleware"],
]);

const verbMethods = new Map<string, RouteMethod>([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Patch", "PATCH"],
  ["Delete", "DELETE"],
  ["Options", "OPTIONS"],
  ["Head", "HEAD"],
  ["All", "ALL"],
  ["Search", "SEARCH"],
]);

// Zero args means the bare path; one string literal carries it; anything
// else can't be recovered and the decorator is skipped.
function stringArg(expression: ts.CallExpression): string | null {
  if (expression.arguments.length === 0) return "";
  if (expression.arguments.length !== 1) return null;
  const arg = expression.arguments[0];
  return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : null;
}

// A decorator like `@Controller("cats")` only counts when the callee resolves
// to a named import from @nestjs/common; `common.Controller()` stays opaque.
function decoratorCall(decorator: ts.Decorator, imports: ReadonlyMap<string, string>): { name: string; call: ts.CallExpression } | undefined {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const callee = decorator.expression.expression;
  if (!ts.isIdentifier(callee)) return undefined;
  const name = imports.get(callee.text);
  return name === undefined ? undefined : { name, call: decorator.expression };
}

// The only argument shapes with a single recoverable meaning; anything else
// — arrays, identifiers, templates with substitutions, more than one arg —
// returns undefined and the class yields no routes.
function controllerPath(expression: ts.CallExpression): string | undefined {
  if (expression.arguments.length === 0) return "";
  if (expression.arguments.length !== 1) return undefined;
  const arg = expression.arguments[0];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (!ts.isObjectLiteralExpression(arg)) return undefined;
  let path: string | undefined;
  for (const property of arg.properties) {
    // Spread, shorthand and methods all hide values behind other identifiers.
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return undefined;
    if (property.name.text === "version") return undefined;
    if (property.name.text === "path") {
      if (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer)) return undefined;
      path = property.initializer.text;
    }
  }
  return path ?? "";
}

export const nestAdapter: ParserAdapter = {
  name: "nestjs",
  detect: (context) => dependsOn(context, "@nestjs/core"),
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  start: (context) => {
    type PendingRoute = { file: string; method: RouteMethod; controllerPath: string; methodPath: string };
    const pending: PendingRoute[] = [];
    const globalPrefixes: Array<string | null> = [];
    let versioning = false;
    let routerModule = false;
    let nestFactoryCreates = 0;

    function repoFacts(source: ts.SourceFile): void {
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const name = node.expression.name.text;
          if (name === "setGlobalPrefix") {
            // One string literal is recoverable; anything else is not.
            globalPrefixes.push(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null);
          } else if (name === "enableVersioning") {
            versioning = true;
          } else if (name === "create" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "NestFactory") {
            nestFactoryCreates += 1;
          }
        }
        ts.forEachChild(node, visit);
      }
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@nestjs/core" &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings) &&
          statement.importClause.namedBindings.elements.some((element) => (element.propertyName ?? element.name).text === "RouterModule")
        ) {
          routerModule = true;
        }
      }
      visit(source);
    }

    function inspect(filePath: string, source: ts.SourceFile): FileRole | null {
      // local name -> imported name, for @nestjs/common named imports only.
      const imports = new Map<string, string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@nestjs/common") continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
          imports.set(element.name.text, (element.propertyName ?? element.name).text);
        }
      }

      const role = fallbackRole(filePath, context.allPaths);
      // Specs bootstrap their own testing app, so their prefix/versioning
      // calls and controllers say nothing about the real application's routes.
      if (role !== "test") {
        repoFacts(source);
      }

      for (const statement of source.statements) {
        if (role === "test" || !ts.isClassDeclaration(statement)) continue;
        let path: string | undefined;
        for (const decorator of ts.getDecorators(statement) ?? []) {
          const call = decoratorCall(decorator, imports);
          if (call?.name !== "Controller") continue;
          path = controllerPath(call.call);
          break;
        }
        if (path === undefined) continue;
        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decorators = ts.getDecorators(member) ?? [];
          // @Version changes the URL; the method can't be reported exactly.
          if (decorators.some((decorator) => decoratorCall(decorator, imports)?.name === "Version")) continue;
          for (const decorator of decorators) {
            const call = decoratorCall(decorator, imports);
            if (!call) continue;
            const method = verbMethods.get(call.name);
            if (!method) continue;
            const methodPath = stringArg(call.call);
            // A decorator whose path isn't a plain literal (or has extra args)
            // is skipped; other decorators on the method still count.
            if (methodPath === null) continue;
            pending.push({ file: filePath, method, controllerPath: path, methodPath });
          }
        }
      }

      const base = (filePath.split("/").at(-1) ?? filePath).replace(/\.(?:c|m)?[jt]sx?$/, "");
      const suffix = base.split(".").at(-1) ?? "";
      return role ?? nestRoles.get(suffix) ?? null;
    }

    function routes(): Route[] {
      // enableVersioning and RouterModule both rewrite the real path; can't
      // recover it exactly, so no routes.
      if (versioning || routerModule) return [];
      let prefix: string;
      if (globalPrefixes.length === 0) {
        prefix = "";
      } else if (globalPrefixes.length === 1 && globalPrefixes[0] !== null && nestFactoryCreates === 1) {
        prefix = globalPrefixes[0];
      } else {
        // Several prefixes, a non-literal one, or a prefix without a single
        // bootstrap to attach it to — would change the real path; absent.
        return [];
      }
      return pending.map((route) => {
        const parts = [prefix, route.controllerPath, route.methodPath].map((part) => part.replace(/^\/+|\/+$/g, "")).filter((part) => part !== "");
        return { file: route.file, method: route.method, path: `/${parts.join("/")}` };
      });
    }

    return { inspect, routes };
  },
};
