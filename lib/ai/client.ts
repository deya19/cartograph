import { OpenAI } from "openai";
import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import { traceable } from "langsmith/traceable";

// Pinned to a snapshot, never an alias: the model name is part of every cache
// key, so re-pinning invalidates only this model's cache.
export const MODEL = "gpt-5.4-mini-2026-03-17";

export type TracingStatus = { enabled: true; project: string } | { enabled: false; reason: string };

let warned = false;

// Tracing is opt-in through the environment; when it is off the calls still
// have to succeed — an absent key must not look like a working setup.
export function tracingStatus(): TracingStatus {
  if (process.env.LANGSMITH_TRACING !== "true") {
    return { enabled: false, reason: 'LANGSMITH_TRACING is not "true"' };
  }
  if (!process.env.LANGSMITH_API_KEY) {
    return { enabled: false, reason: "LANGSMITH_API_KEY is not set" };
  }
  return { enabled: true, project: process.env.LANGSMITH_PROJECT ?? "default" };
}

function warnOnce(status: TracingStatus): void {
  if (status.enabled || warned) return;
  warned = true;
  console.warn(`LangSmith tracing off: ${status.reason} — calls are not recorded`);
}

// Constructed unconditionally: without an apiKey the client is inert but never
// throws, and nothing reaches it while tracing is disabled.
const client = new Client();

let inner: OpenAI | null = null;

// The OpenAI constructor throws without a key; this page imports this module
// for tracingStatus, so the error has to wait for an actual model call.
function requireOpenAI(): OpenAI {
  if (inner === null) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing required environment variable: OPENAI_API_KEY");
    }
    inner = new OpenAI();
  }
  return inner;
}

// wrapOpenAI patches chat.completions.create for tracing; the facade defers
// building the real client to the first call so a missing key is a call-time
// error, not an import-time one.
export const openai = wrapOpenAI(
  {
    chat: {
      completions: {
        create: (arg: OpenAI.ChatCompletionCreateParamsNonStreaming, arg2?: OpenAI.RequestOptions) =>
          requireOpenAI().chat.completions.create(arg, arg2),
      },
    },
    completions: {
      create: (arg: OpenAI.CompletionCreateParamsNonStreaming, arg2?: OpenAI.RequestOptions) =>
        requireOpenAI().completions.create(arg, arg2),
    },
  },
  { client },
);

export function traced<I extends Record<string, unknown>, R>(name: string, inputs: I, fn: (inputs: I) => Promise<R>): Promise<R> {
  warnOnce(tracingStatus());
  // TraceableFunction's conditional types collapse to {} over a generic
  // parameter, so the traceable is built on a concrete Record signature and
  // fn sees the typed inputs from the closure — the recorded argument and the
  // argument fn receives are the same object.
  const wrapped = traceable(
    (recorded: Record<string, unknown>) => {
      // `recorded` is what the trace writes as run inputs; fn closes over the
      // same object with its real type.
      void recorded;
      return fn(inputs);
    },
    { name, client, run_type: "chain" },
  );
  return wrapped(inputs);
}

export async function flushTraces(): Promise<void> {
  await client.awaitPendingTraceBatches();
}
