// The NDJSON contract between /api/ask and the chat panel. One JSON object
// per line, in this order: thread, then tool_start/tool_end/answer as the
// agent works, then done — or error anywhere a failure surfaces.
export type AskEvent =
  | { type: "thread"; threadId: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, string> }
  | { type: "tool_end"; id: string; ok: boolean }
  | { type: "answer"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function isAskEvent(value: unknown): value is AskEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "thread":
      return typeof value.threadId === "string";
    case "tool_start":
      return typeof value.id === "string" && typeof value.name === "string" && isStringRecord(value.args);
    case "tool_end":
      return typeof value.id === "string" && typeof value.ok === "boolean";
    case "answer":
      return typeof value.text === "string";
    case "error":
      return typeof value.message === "string";
    case "done":
      return true;
    default:
      return false;
  }
}
