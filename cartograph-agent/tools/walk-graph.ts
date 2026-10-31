import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const walkGraph = tool(
  async ({ path, direction }: { path: string; direction: "dependents" | "dependencies" }, runtime: ToolRuntime) =>
    agentGet("/api/agent/walk", analysisToken(runtime.context), {
      path,
      direction,
    }),
  {
    name: "walk_graph",
    description:
      "Walk the import graph from one file. direction \"dependents\" answers \"what breaks if I change this / what depends on it\"; direction \"dependencies\" answers \"what this needs\". Only resolved edges are walked. The path must be an exact path from an earlier result.",
    schema: z.object({
      path: z.string().describe("Exact file path from an earlier result"),
      direction: z
        .enum(["dependents", "dependencies"])
        .describe("Which way to walk from the file"),
    }),
  }
);
