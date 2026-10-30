import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const repositorySummary = tool(
  async (_input: unknown, runtime: ToolRuntime) =>
    agentGet("/api/agent/summary", analysisToken(runtime.context)),
  {
    name: "repository_summary",
    description:
      "Overview of the whole repository analysis: which parser adapter ran, file and edge counts, the most imported files, files nothing imports, and which file roles are present. Call this first when you don't know the repository yet. Results are what the parser resolved, not guesses.",
    schema: z.object({}),
  }
);
