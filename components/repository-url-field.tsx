// The one repository field. The workspace and the landing page both render
// this, so the first thing a stranger types into is the thing they'll use.
export function RepositoryUrlField({
  pending = false,
  error,
  defaultValue,
}: {
  pending?: boolean;
  error: string | null;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          aria-label="GitHub repository URL"
          className="w-full min-w-0 max-w-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-foreground placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          defaultValue={defaultValue}
          disabled={pending}
          name="url"
          placeholder="https://github.com/owner/repo"
          type="text"
        />
        <button
          className="shrink-0 border border-blue-600 bg-blue-600 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {error ? <p className="font-mono text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}
