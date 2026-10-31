import { authenticateAgentRequest } from "@/lib/agent/api";
import { repositorySummary, rolesPresent } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const granted = await authenticateAgentRequest(request);
  if (granted instanceof Response) return granted;
  const { result, modelRoles } = granted;

  const summary = repositorySummary(result.files, result.edges);
  return Response.json({
    repository: result.root,
    adapter: result.adapter,
    files: result.files.length,
    edges: result.edges.length,
    routes: result.routes.length,
    mostImported: summary.mostImported,
    unimported: summary.unimported,
    unimportedTotal: summary.unimportedTotal,
    roles: rolesPresent(result.files, modelRoles),
  });
}
