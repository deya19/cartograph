import "server-only";
import type { AskEvent } from "./ask-events";

// Translates the LangGraph server's SSE stream into the NDJSON events the
// panel understands. Only `updates` frames carry anything we relay; node
// names are not ours to know, so every value in the update object is walked.

type AgentMessage = {
  id: string | null;
  kind: "ai" | "tool";
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, string> }[];
  toolCallId: string | null;
  status: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Message content is either a plain string or a list of parts where only the
// text parts are worth relaying.
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function parseToolCalls(value: unknown): AgentMessage["toolCalls"] {
  if (!Array.isArray(value)) return [];
  const calls: AgentMessage["toolCalls"] = [];
  for (const call of value) {
    if (!isRecord(call) || typeof call.name !== "string") continue;
    const args: Record<string, string> = {};
    if (isRecord(call.args)) {
      for (const [key, arg] of Object.entries(call.args)) {
        args[key] = typeof arg === "string" ? arg : JSON.stringify(arg);
      }
    }
    calls.push({ id: typeof call.id === "string" ? call.id : call.name, name: call.name, args });
  }
  return calls;
}

// Messages arrive either already decoded ({type: "ai"|"tool", ...}) or as
// LangChain-serialized constructors ({lc: 1, id: [..., "AIMessage"], kwargs}).
function normalizeMessage(raw: unknown): AgentMessage | null {
  if (!isRecord(raw)) return null;

  let kind: "ai" | "tool";
  let fields: Record<string, unknown>;
  let toolCallsValue: unknown;

  if (raw.lc === 1 && isRecord(raw.kwargs)) {
    const typeName = Array.isArray(raw.id) ? raw.id.at(-1) : undefined;
    if (typeName === "AIMessage" || typeName === "AIMessageChunk") kind = "ai";
    else if (typeName === "ToolMessage") kind = "tool";
    else return null;
    fields = raw.kwargs;
    toolCallsValue = fields.tool_calls;
  } else if (raw.type === "ai" || raw.type === "tool") {
    kind = raw.type;
    fields = raw;
    toolCallsValue = raw.tool_calls;
  } else {
    return null;
  }

  return {
    id: asString(fields.id),
    kind,
    text: messageText(fields.content),
    toolCalls: parseToolCalls(toolCallsValue),
    toolCallId: asString(fields.tool_call_id),
    status: asString(fields.status),
  };
}

function relayMessage(message: AgentMessage, emit: (event: AskEvent) => void, seen: Set<string>) {
  // The runtime can re-emit a message in a later update; the id dedupes.
  const key = message.id ?? (message.kind === "tool" ? message.toolCallId : null);
  if (key !== null) {
    if (seen.has(key)) return;
    seen.add(key);
  }

  if (message.kind === "ai") {
    if (message.toolCalls.length > 0) {
      for (const call of message.toolCalls) {
        emit({ type: "tool_start", id: call.id, name: call.name, args: call.args });
      }
    } else if (message.text.trim() !== "") {
      emit({ type: "answer", text: message.text });
    }
    return;
  }

  const content = message.text;
  emit({
    type: "tool_end",
    id: message.toolCallId ?? message.id ?? "",
    ok: message.status !== "error" && !content.startsWith("Lookup failed"),
  });
}

function relayUpdatesFrame(data: string, emit: (event: AskEvent) => void, seen: Set<string>) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  for (const update of Object.values(parsed)) {
    if (!isRecord(update) || !Array.isArray(update.messages)) continue;
    for (const raw of update.messages) {
      const message = normalizeMessage(raw);
      if (message !== null) relayMessage(message, emit, seen);
    }
  }
}

const FRAME_END = /\r?\n\r?\n/;

// Reads the upstream SSE body and relays each frame. Frames are separated by
// a blank line and carry `event:` / `data:` lines; anything but an `updates`
// frame only matters when it is an `error`. Upstream error bodies are never
// forwarded — the client gets our own message.
export async function relayAgentStream(
  body: ReadableStream<Uint8Array>,
  emit: (event: AskEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seen = new Set<string>();
  let buffer = "";

  const handleFrame = (frame: string) => {
    let event = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (event === "updates") relayUpdatesFrame(data.join("\n"), emit, seen);
    else if (event === "error") emit({ type: "error", message: "The agent stopped mid-answer." });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = FRAME_END.exec(buffer)) !== null) {
        handleFrame(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") handleFrame(buffer);
  } finally {
    reader.releaseLock();
  }
}
