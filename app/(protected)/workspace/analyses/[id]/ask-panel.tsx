"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import type { GraphGroup } from "@/lib/graph";
import { isAskEvent } from "@/lib/agent/ask-events";
import { ExplanationText } from "./explanation-text";

export type AskStep = {
  id: string;
  name: string;
  args: Record<string, string>;
  state: "running" | "done" | "failed";
};

export type AskTurn = {
  id: number;
  question: string;
  steps: AskStep[];
  answer: string | null;
  error: string | null;
  finished: boolean;
};

export type AskConversation = {
  turns: AskTurn[];
  streaming: boolean;
  send: (message: string, selectedPath: string | null) => void;
  reset: () => void;
};

// A turn is rewritten event-by-event as the stream arrives; this is the one
// place every event lands.
function updateTurn(turns: AskTurn[], id: number, change: (turn: AskTurn) => AskTurn): AskTurn[] {
  return turns.map((turn) => (turn.id === id ? change(turn) : turn));
}

export function useAskConversation(analysisId: string): AskConversation {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const threadId = useRef<string | null>(null);
  const nextId = useRef(0);
  const busy = useRef(false);

  const send = useCallback(
    (message: string, selectedPath: string | null) => {
      const question = message.trim();
      if (question === "" || busy.current) return;
      busy.current = true;
      setStreaming(true);

      const turnId = nextId.current++;
      setTurns((current) => [...current, { id: turnId, question, steps: [], answer: null, error: null, finished: false }]);
      const change = (fn: (turn: AskTurn) => AskTurn) => setTurns((current) => updateTurn(current, turnId, fn));
      const fail = (error: string) => {
        change((turn) => ({ ...turn, error, finished: true }));
        busy.current = false;
        setStreaming(false);
      };

      const run = async () => {
        let response: Response;
        try {
          response = await fetch("/api/ask", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ analysisId, threadId: threadId.current, message: question, selectedPath }),
          });
        } catch {
          fail("The agent isn't reachable right now.");
          return;
        }
        if (!response.ok || response.body === null) {
          let message = "The agent isn't reachable right now.";
          try {
            const body: unknown = await response.json();
            if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
              message = body.error;
            }
          } catch {
            // Keep the generic message.
          }
          fail(message);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.trim() === "") continue;
              let event: unknown;
              try {
                event = JSON.parse(line);
              } catch {
                continue;
              }
              if (!isAskEvent(event)) continue;
              if (event.type === "thread") {
                threadId.current = event.threadId;
              } else if (event.type === "tool_start") {
                const { id, name, args } = event;
                change((turn) => ({ ...turn, steps: [...turn.steps, { id, name, args, state: "running" }] }));
              } else if (event.type === "tool_end") {
                const { id, ok } = event;
                change((turn) => ({
                  ...turn,
                  steps: turn.steps.map((step) => (step.id === id ? { ...step, state: ok ? "done" : "failed" } : step)),
                }));
              } else if (event.type === "answer") {
                change((turn) => ({ ...turn, answer: event.text }));
              } else if (event.type === "error") {
                change((turn) => ({ ...turn, error: event.message }));
              }
            }
          }
        } catch {
          change((turn) => ({ ...turn, error: turn.error ?? "The agent stopped mid-answer." }));
        } finally {
          change((turn) => ({ ...turn, finished: true }));
          busy.current = false;
          setStreaming(false);
        }
      };
      void run();
    },
    [analysisId],
  );

  const reset = useCallback(() => {
    threadId.current = null;
    setTurns([]);
  }, []);

  return { turns, streaming, send, reset };
}

const TOOL_LABELS: Record<string, string> = {
  repository_summary: "summary",
  search_files: "search files",
  files_by_role: "files by role",
  file_neighbours: "neighbours",
  route_table: "routes",
};

// walk_graph's direction lives in its args, so the label reads "walk
// dependents · lib/auth.ts"; anything unknown keeps its raw tool name.
function stepLabel(step: AskStep): string {
  if (step.name === "walk_graph") {
    return step.args.direction === "dependencies" ? "walk dependencies" : "walk dependents";
  }
  return TOOL_LABELS[step.name] ?? step.name;
}

function stepArgs(step: AskStep): string[] {
  return Object.entries(step.args)
    .filter(([key]) => key !== "direction")
    .map(([, value]) => value);
}

function StepRow({ step, filePaths, onRevealFile }: { step: AskStep; filePaths: ReadonlySet<string>; onRevealFile: (path: string) => void }) {
  return (
    <p className="font-mono text-[10px] leading-4 text-(--text-muted)">
      {stepLabel(step)}
      {stepArgs(step).map((arg, index) => (
        <span key={index}>
          {" · "}
          {filePaths.has(arg) ? (
            <button className="text-(--select) hover:underline" type="button" onClick={() => onRevealFile(arg)}>
              {arg}
            </button>
          ) : (
            arg
          )}
        </span>
      ))}
      {step.state === "running" ? <span className="text-(--text-faint)"> …</span> : null}
      {step.state === "failed" ? <span className="text-rose-600 dark:text-rose-400"> · failed</span> : null}
    </p>
  );
}

export function AskPanel({
  conversation,
  selectedPath,
  filePaths,
  groupByPath,
  onRevealFile,
  onRevealGroup,
}: {
  conversation: AskConversation;
  selectedPath: string | null;
  filePaths: ReadonlySet<string>;
  groupByPath: ReadonlyMap<string, GraphGroup>;
  onRevealFile: (path: string) => void;
  onRevealGroup: (group: GraphGroup) => void;
}) {
  const { turns, streaming, send, reset } = conversation;
  const [draft, setDraft] = useState("");

  const submit = () => {
    send(draft, selectedPath);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-3 pt-2">
        <button
          className="font-mono text-[10px] leading-4 text-(--text-faint) hover:text-(--text-muted)"
          type="button"
          onClick={reset}
        >
          new conversation
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <p className="px-1 font-mono text-[10px] leading-4 text-(--text-faint)">
            Ask about this repository&apos;s structure.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn) => (
              <div key={turn.id}>
                <p className="font-mono text-[11px] leading-4 text-(--text-strong)">{turn.question}</p>
                <div className="mt-1 flex flex-col gap-0.5">
                  {turn.steps.map((step, index) => (
                    <StepRow key={`${step.id}-${index}`} filePaths={filePaths} onRevealFile={onRevealFile} step={step} />
                  ))}
                </div>
                {turn.answer !== null ? (
                  <div className="mt-1.5">
                    <ExplanationText
                      filePaths={filePaths}
                      groupByPath={groupByPath}
                      onRevealFile={onRevealFile}
                      onRevealGroup={onRevealGroup}
                      text={turn.answer}
                    />
                  </div>
                ) : null}
                {turn.error !== null ? (
                  <p className="mt-1.5 font-mono text-[10px] leading-4 text-rose-600 dark:text-rose-400">{turn.error}</p>
                ) : null}
                {turn.finished && turn.answer !== null && turn.steps.length === 0 ? (
                  <p className="mt-1.5 font-mono text-[10px] leading-4 text-(--text-faint)">
                    no lookups behind this answer
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {selectedPath !== null ? (
          <p className="truncate px-1 pb-1 font-mono text-[11px] leading-4 text-(--text-muted)" title={selectedPath}>
            With {selectedPath} selected
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-14 min-w-0 flex-1 resize-none rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-[11px] leading-4 text-(--text) outline-none placeholder:text-(--text-faint) focus:border-(--select) disabled:text-(--text-faint) dark:border-zinc-700 dark:bg-zinc-950"
            disabled={streaming}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about this repository"
            rows={2}
            value={draft}
          />
          <button
            className="mb-0.5 rounded bg-(--select)/60 px-3 py-1.5 font-mono text-[11px] leading-4 text-white hover:bg-(--select)/80 disabled:cursor-default disabled:opacity-50"
            disabled={streaming || draft.trim() === ""}
            type="button"
            onClick={submit}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
