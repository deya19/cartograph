import { fallbackAdapter } from "./fallback.ts";
import { nestAdapter } from "./nest.ts";
import { nextAdapter } from "./next.ts";
import { reactAdapter } from "./react.ts";
import type { ParserAdapter, ProjectContext } from "./types.ts";

export type { AdapterRun, ParserAdapter, ProjectContext } from "./types.ts";

// The order is fixed so the same repository always gets the same adapter; a
// Nest or Next app also depends on React, so those checks run first.
export function detectAdapter(context: ProjectContext): ParserAdapter {
  for (const adapter of [nestAdapter, nextAdapter, reactAdapter]) {
    if (adapter.detect(context)) return adapter;
  }
  return fallbackAdapter;
}
