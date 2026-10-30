import { AGENT_LIST_LIMIT, authenticateAgentRequest } from "@/lib/agent/api";
import { buildAdjacency, transitiveWalk } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const granted = await authenticateAgentRequest(request);
  if (granted instanceof Response) return granted;
  const { result } = granted;

  const params = new URL(request.url).searchParams;
  const path = params.get("path");
  const direction = params.get("direction");
  if (path === null || path === "") {
    return Response.json({ error: "Pass a path." }, { status: 400 });
  }
  if (direction !== "dependents" && direction !== "dependencies") {
    return Response.json(
      { error: "Direction must be dependents or dependencies." },
      { status: 400 },
    );
  }
  if (!result.files.some((file) => file.path === path)) {
    return Response.json({ error: "No file with that path in this analysis." }, { status: 404 });
  }

  const files = transitiveWalk(buildAdjacency(result.edges), path, direction);
  return Response.json({
    path,
    direction,
    total: files.length,
    files: files.slice(0, AGENT_LIST_LIMIT),
  });
}
