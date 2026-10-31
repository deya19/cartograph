import "dotenv/config";
import { defineDeepAgent } from "managed-deepagents";
import * as z from "zod";

import { fileNeighbours } from "./tools/file-neighbours";
import { filesByRole } from "./tools/files-by-role";
import { repositorySummary } from "./tools/repository-summary";
import { routeTable } from "./tools/route-table";
import { searchFiles } from "./tools/search-files";
import { walkGraph } from "./tools/walk-graph";

export const agent = defineDeepAgent({
  name: "cartograph",
  model: "openai:gpt-5.5",
  tools: [
    repositorySummary,
    searchFiles,
    filesByRole,
    fileNeighbours,
    walkGraph,
    routeTable,
  ],
  // The bearer token for the Cartograph API arrives per run in this context.
  // Tools read it from the LangChain runtime; the model never sees it.
  contextSchema: z.object({ analysisToken: z.string() }),
});
