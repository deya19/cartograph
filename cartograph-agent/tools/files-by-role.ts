import { tool, type ToolRuntime } from "langchain";
import * as z from "zod";

import { agentGet, analysisToken } from "./http";

export const filesByRole = tool(
  async ({ role }: { role: string }, runtime: ToolRuntime) =>
    agentGet("/api/agent/files", analysisToken(runtime.context), { role }),
  {
    name: "files_by_role",
    description:
      "List files the parser assigned to a role, such as routes or components. Roles are a plain string, not a fixed list: call repository_summary first to see which roles this analysis actually contains.",
    schema: z.object({
      role: z.string().describe("A role reported by repository_summary"),
    }),
  }
);
