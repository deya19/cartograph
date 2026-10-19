"use client";

import { useActionState } from "react";
import { analyzeRepository, type AnalyzeFormState } from "./actions";

const initialState: AnalyzeFormState = { error: null };

export function AnalyzeForm() {
  const [state, formAction, pending] = useActionState(analyzeRepository, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="w-full max-w-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-foreground placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          disabled={pending}
          name="url"
          placeholder="https://github.com/owner/repo"
          type="text"
        />
        <button
          className="border border-blue-600 bg-blue-600 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {state.error ? <p className="font-mono text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
    </form>
  );
}
