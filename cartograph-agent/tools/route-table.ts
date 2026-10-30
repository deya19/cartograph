import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const routeTable = tool(
  async (_input: unknown, runtime: ToolRuntime) =>
    agentGet("/api/agent/routes", analysisToken(runtime.context)),
  {
    name: "route_table",
    description:
      "The routes the parser could fully recover for this repository. Only routes the parser resolved are listed; if it could not recover them the result says so rather than guessing.",
    schema: z.object({}),
  }
);
