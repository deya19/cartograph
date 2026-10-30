import { AGENT_LIST_LIMIT, authenticateAgentRequest } from "@/lib/agent/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const granted = await authenticateAgentRequest(request);
  if (granted instanceof Response) return granted;
  const { result } = granted;

  return Response.json({
    total: result.routes.length,
    routes: result.routes
      .slice(0, AGENT_LIST_LIMIT)
      .map((route) => ({ method: route.method, path: route.path, file: route.file })),
  });
}
