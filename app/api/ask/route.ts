import "server-only";
import { auth } from "@clerk/nextjs/server";
import { UUID_PATTERN } from "@/lib/analysis/load";
import { mintAgentGrant } from "@/lib/agent/grant";
import { relayAgentStream } from "@/lib/agent/ask-stream";
import type { AskEvent } from "@/lib/agent/ask-events";

export const dynamic = "force-dynamic";

const MAX_MESSAGE = 2000;
const AGENT_UNREACHABLE = { error: "The agent isn't reachable right now." };

type AskBody = {
  analysisId: string;
  threadId: string | null;
  message: string;
  selectedPath: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBody(body: unknown): AskBody | null {
  if (!isRecord(body)) return null;
  const { analysisId, threadId, selectedPath } = body;
  if (typeof analysisId !== "string" || !UUID_PATTERN.test(analysisId)) return null;
  if (threadId !== null && (typeof threadId !== "string" || !UUID_PATTERN.test(threadId))) return null;
  if (selectedPath !== null && typeof selectedPath !== "string") return null;
  if (typeof body.message !== "string") return null;
  const message = body.message.trim();
  if (message === "" || message.length > MAX_MESSAGE) return null;
  return { analysisId, threadId, message, selectedPath };
}

// Opens a conversation, or confirms an existing one belongs to this analysis
// and organization — thread ids from the client are not proof of either.
type ThreadResolution = { threadId: string } | "foreign" | "unreachable";

async function resolveThread(base: string, body: AskBody, orgId: string): Promise<ThreadResolution> {
  if (body.threadId === null) {
    const response = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { analysis_id: body.analysisId, organization_id: orgId } }),
    });
    if (!response.ok) return "unreachable";
    const thread: unknown = await response.json().catch(() => null);
    if (!isRecord(thread)) return "unreachable";
    const threadId = thread.thread_id;
    return typeof threadId === "string" ? { threadId } : "unreachable";
  }

  const response = await fetch(`${base}/threads/${body.threadId}`);
  if (response.status === 404) return "foreign";
  if (!response.ok) return "unreachable";
  const thread: unknown = await response.json().catch(() => null);
  if (!isRecord(thread)) return "unreachable";
  const owner = thread.metadata;
  if (!isRecord(owner)) return "foreign";
  return owner.analysis_id === body.analysisId && owner.organization_id === orgId
    ? { threadId: body.threadId }
    : "foreign";
}

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return Response.json({ error: "Sign in with an organization selected." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (body === null) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // The grant is the ownership proof; minting fails when the analysis is not
  // this organization's. A fresh one per message means threads outlive it.
  const token = await mintAgentGrant(body.analysisId);
  if (token === null) {
    return Response.json({ error: "Analysis not found." }, { status: 404 });
  }

  // Read here rather than in lib/env.ts so the rest of the app keeps working
  // when the agent is not configured.
  const base = process.env.CARTOGRAPH_AGENT_URL;
  if (!base) {
    return Response.json({ error: "The agent is not configured (CARTOGRAPH_AGENT_URL)." }, { status: 503 });
  }

  const content =
    body.selectedPath !== null
      ? `${body.message}\n\n(Selected in the map: \`${body.selectedPath}\`)`
      : body.message;

  let threadId: string;
  let upstream: Response;
  try {
    const resolved = await resolveThread(base.replace(/\/$/, ""), body, orgId);
    if (resolved === "foreign") {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }
    if (resolved === "unreachable") {
      return Response.json(AGENT_UNREACHABLE, { status: 502 });
    }
    threadId = resolved.threadId;
    // The credential travels in context only — never inside a message, where
    // repository content could talk the agent into leaking or swapping it.
    upstream = await fetch(`${base.replace(/\/$/, "")}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assistant_id: "cartograph",
        input: { messages: [{ role: "user", content }] },
        context: { analysisToken: token },
        stream_mode: ["updates"],
      }),
    });
    if (!upstream.ok || upstream.body === null) {
      return Response.json(AGENT_UNREACHABLE, { status: 502 });
    }
  } catch {
    return Response.json(AGENT_UNREACHABLE, { status: 502 });
  }

  const encoder = new TextEncoder();
  const upstreamBody = upstream.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      emit({ type: "thread", threadId });
      try {
        await relayAgentStream(upstreamBody, emit);
        emit({ type: "done" });
      } catch {
        emit({ type: "error", message: "The agent stopped mid-answer." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
