// Side-effect module: loads env files the way Next does in development, so
// scripts see the same variables as the app. Paths resolve from this file's
// location, not the cwd — npm run is always project root, but a bare node
// invocation might not be.
//
// loadEnvFile never overrides a variable that is already set, so loading in
// this order gives .env.development.local first claim — matching Next's
// precedence of .env.development.local > .env.local > .env.development > .env.
// It also runs before any real import: ESM evaluates a module's imports in
// source order, and the LangSmith client reads its key at construction.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

for (const name of [".env.development.local", ".env.local", ".env.development", ".env"]) {
  const file = path.join(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}
