import { expressAdapter } from "./express.ts";
import { fallbackAdapter } from "./fallback.ts";
import { nestAdapter } from "./nest.ts";
import { nextAdapter } from "./next.ts";
import { reactAdapter } from "./react.ts";
import type { ParserAdapter, ProjectContext } from "./types.ts";

export type { AdapterRun, ParserAdapter, ProjectContext } from "./types.ts";

// The order is fixed so the same repository always gets the same adapter;
// Nest, Next and Express apps can all also depend on React, so React runs last.
export function detectAdapter(context: ProjectContext): ParserAdapter {
  for (const adapter of [nestAdapter, nextAdapter, expressAdapter, reactAdapter]) {
    if (adapter.detect(context)) return adapter;
  }
  return fallbackAdapter;
}
