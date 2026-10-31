import { AGENT_LIST_LIMIT, authenticateAgentRequest } from "@/lib/agent/api";
import { filesWithRole, rolesPresent, searchFiles } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const granted = await authenticateAgentRequest(request);
  if (granted instanceof Response) return granted;
  const { result, modelRoles } = granted;

  const params = new URL(request.url).searchParams;
  const query = params.get("query");
  const role = params.get("role");

  if (query !== null && role !== null) {
    return Response.json({ error: "Pass only one of query or role." }, { status: 400 });
  }

  if (query !== null) {
    const matches = searchFiles(result.files, query);
    return Response.json({
      query,
      total: matches.length,
      files: matches.slice(0, AGENT_LIST_LIMIT).map((path) => ({ path })),
    });
  }

  if (role !== null) {
    const matches = filesWithRole(result.files, modelRoles, role);
    if (matches.length === 0) {
      return Response.json(
        {
          error: "No files with that role in this analysis.",
          roles: rolesPresent(result.files, modelRoles),
        },
        { status: 404 },
      );
    }
    return Response.json({
      role,
      total: matches.length,
      files: matches.slice(0, AGENT_LIST_LIMIT),
    });
  }

  return Response.json({ error: "Pass one of query or role." }, { status: 400 });
}
