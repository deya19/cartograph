import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const searchFiles = tool(
  async ({ query }: { query: string }, runtime: ToolRuntime) =>
    agentGet("/api/agent/files", analysisToken(runtime.context), { query }),
  {
    name: "search_files",
    description:
      "Find files by part of a path. Returns the paths the parser recorded, spelled exactly as they appear in the analysis. Use this to find a starting file before looking at its neighbours or walking the graph.",
    schema: z.object({
      query: z.string().describe("Part of a file path to search for"),
    }),
  }
);
