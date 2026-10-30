// Shared plumbing for the six Cartograph API tools. Everything the tools do is
// one signed GET against the Next.js app; the token arrives per run in the
// LangChain runtime context, never in a message, so it must stay out of tool
// results and tool descriptions.

const UNREACHABLE = "Lookup failed: the analysis could not be reached.";

export function analysisToken(context: unknown): string {
  if (
    typeof context !== "object" ||
    context === null ||
    !("analysisToken" in context) ||
    typeof context.analysisToken !== "string" ||
    context.analysisToken.length === 0
  ) {
    // Missing context is a wiring bug between the caller and the agent, not a
    // failure the model can recover from, so it throws instead of returning a
    // message.
    throw new Error("analysisToken missing from run context");
  }
  return context.analysisToken;
}

export async function agentGet(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<string> {
  const baseUrl = process.env.CARTOGRAPH_API_URL;
  if (!baseUrl) {
    throw new Error("CARTOGRAPH_API_URL is not set");
  }
  const url = new URL(path, baseUrl);
  if (params) {
    url.search = new URLSearchParams(params).toString();
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return UNREACHABLE;
  }
  const body = await response.text();
  if (!response.ok) {
    // Non-2xx goes back to the model so e.g. an unknown path is a "not found",
    // not a crashed lookup. The body comes from our own API, never the token.
    return `Lookup failed (${response.status}): ${body}`;
  }
  return body;
}
