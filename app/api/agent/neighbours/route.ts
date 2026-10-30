import { AGENT_LIST_LIMIT, authenticateAgentRequest } from "@/lib/agent/api";
import { fileNeighbours } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const granted = await authenticateAgentRequest(request);
  if (granted instanceof Response) return granted;
  const { result } = granted;

  const path = new URL(request.url).searchParams.get("path");
  if (path === null || path === "") {
    return Response.json({ error: "Pass a path." }, { status: 400 });
  }
  if (!result.files.some((file) => file.path === path)) {
    return Response.json({ error: "No file with that path in this analysis." }, { status: 404 });
  }

  const { imports, importedBy } = fileNeighbours(path, result.edges);
  return Response.json({
    path,
    importsTotal: imports.length,
    imports: imports.slice(0, AGENT_LIST_LIMIT),
    importedByTotal: importedBy.length,
    importedBy: importedBy.slice(0, AGENT_LIST_LIMIT),
  });
}
