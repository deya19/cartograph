import { auth } from "@clerk/nextjs/server";

export default async function WorkspacePage() {
  const { orgId, orgSlug } = await auth();

  return (
    <section className="mx-auto flex min-h-[calc(100vh-57px)] w-full max-w-6xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blue-600">
        Workspace
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Ready to map your repository.
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">
        This workspace belongs to the active organization. Repository maps and
        their data will appear here in the next phase.
      </p>
      <dl className="mt-10 grid max-w-xl grid-cols-2 gap-3 font-mono text-xs">
        <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <dt className="text-zinc-500">organization id</dt>
          <dd className="mt-2 break-all text-foreground">{orgId}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <dt className="text-zinc-500">organization slug</dt>
          <dd className="mt-2 break-all text-foreground">{orgSlug ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
