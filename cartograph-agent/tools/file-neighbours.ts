import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const fileNeighbours = tool(
  async ({ path }: { path: string }, runtime: ToolRuntime) =>
    agentGet("/api/agent/neighbours", analysisToken(runtime.context), { path }),
  {
    name: "file_neighbours",
    description:
      "Direct neighbours of one file: the files it imports and the files that import it. Only connections the parser resolved to real files are returned. The path must be an exact path from an earlier result.",
    schema: z.object({
      path: z.string().describe("Exact file path from an earlier result"),
    }),
  }
);
