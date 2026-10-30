import "server-only";
import { loadGrantedAnalysis, loadResult, type AnalysisRow } from "../analysis/load";
import type { ParseResult } from "../parser/types";
import type { ModelRole } from "../roles";
import { createSupabaseAgentClient } from "../supabase/agent";

// Every list the agent endpoints return is capped here; each response carries
// the uncapped total so the model can say how many it left out.
export const AGENT_LIST_LIMIT = 50;

const CREDENTIAL_ERROR = { error: "The credential is missing, unknown or expired." };

export type GrantedAnalysis = {
  analysis: AnalysisRow;
  result: ParseResult;
  modelRoles: Record<string, ModelRole>;
};

function bearerToken(request: Request): string | null {
  const prefix = "Bearer ";
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length).trim();
  return token === "" ? null : token;
}

// Returns the granted analysis fully loaded, or the error response the
// handler should return. The token is only ever hashed inside Postgres; it is
// never echoed into a response.
export async function authenticateAgentRequest(request: Request): Promise<GrantedAnalysis | Response> {
  const token = bearerToken(request);
  if (token === null) {
    return Response.json(CREDENTIAL_ERROR, { status: 401 });
  }
  try {
    const supabase = createSupabaseAgentClient(token);
    const analysis = await loadGrantedAnalysis(supabase);
    if (analysis === null) {
      return Response.json(CREDENTIAL_ERROR, { status: 401 });
    }
    if (analysis.status !== "complete") {
      return Response.json({ error: "The analysis is not complete yet." }, { status: 409 });
    }
    const { result, modelRoles } = await loadResult(supabase, analysis);
    return { analysis, result, modelRoles };
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
