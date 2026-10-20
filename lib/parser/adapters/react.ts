import ts from "typescript";
import type { FileRole } from "../../roles.ts";
import { dependsOn, fallbackRole } from "./fallback.ts";
import type { ParserAdapter } from "./types.ts";

function containsJsx(source: ts.SourceFile): boolean {
  // Iterative with early exit: a real app's files are deep enough that the
  // recursion stays explicit, and the first node found ends the search.
  const stack: ts.Node[] = [source];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
    // forEachChild stops at the first truthy return — push returns a length,
    // so the callback must return nothing.
    node.forEachChild((child) => {
      stack.push(child);
    });
  }
  return false;
}

export function reactRole(filePath: string, source: ts.SourceFile): FileRole | null {
  const base = filePath.split("/").at(-1) ?? filePath;
  const stem = base.replace(/\.(?:c|m)?[jt]sx?$/, "");
  // Hooks are named, components are recognised by what they return.
  if (/^use[A-Z0-9]/.test(stem)) return "hook";
  if (containsJsx(source)) return "component";
  return null;
}

export const reactAdapter: ParserAdapter = {
  name: "react",
  detect: (context) => dependsOn(context, "react"),
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  start: (context) => ({
    inspect: (filePath, source) => fallbackRole(filePath, context.allPaths) ?? reactRole(filePath, source),
    routes: () => [],
  }),
};
