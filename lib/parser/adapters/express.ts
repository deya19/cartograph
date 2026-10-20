import type { FileRole } from "../../roles.ts";
import { dependsOn, fallbackRole } from "./fallback.ts";
import type { ParserAdapter } from "./types.ts";

// Express has no file conventions, so roles come from the directory a file
// sits in — singular and plural both count, and the deepest matching segment
// wins so routes/user.ts beats an outer controllers directory.
const directoryRoles = new Map<string, FileRole>([
  ["route", "route"],
  ["routes", "route"],
  ["router", "route"],
  ["routers", "route"],
  ["controller", "controller"],
  ["controllers", "controller"],
  ["middleware", "middleware"],
  ["middlewares", "middleware"],
  ["service", "service"],
  ["services", "service"],
  ["model", "model"],
  ["models", "model"],
]);

function expressRole(filePath: string): FileRole | null {
  const segments = filePath.split("/").slice(0, -1);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const role = directoryRoles.get(segments[index].toLowerCase());
    if (role) return role;
  }
  return null;
}

export const expressAdapter: ParserAdapter = {
  name: "express",
  detect: (context) => dependsOn(context, "express"),
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
  start: (context) => ({
    inspect: (filePath) => fallbackRole(filePath, context.allPaths) ?? expressRole(filePath),
    // Express routes are assembled at runtime from routers, variables and
    // middleware chains — exact-or-absent means absent.
    routes: () => [],
  }),
};
