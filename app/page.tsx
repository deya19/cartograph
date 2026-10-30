import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ThemeControl } from "@/components/theme-control";
import { HeroForm } from "./hero-form";
import { MapFigure, PipelineFigure, SelectionFigure } from "./landing-figures";

// Every line on this page has to be demonstrable by someone who clicks
// through in the next thirty seconds — if the product stops doing a thing,
// the sentence about it goes too.

const column = "mx-auto w-full max-w-[1140px] px-6";
const section = "border-t border-(--node-divider) py-24 sm:py-32";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.18em] text-(--text-muted)";
const heading = "text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-(--text-strong)";
const body = "text-[15px] leading-7 text-(--text)";

const frameworks: Array<{ name: string; recognises: string; routes: string }> = [
  {
    name: "Next.js",
    recognises: "Pages, layouts, route handlers, server actions, middleware, and the files Next loads by itself.",
    routes: "From the app and pages directories, unless basePath, i18n or pageExtensions would change them.",
  },
  {
    name: "NestJS",
    recognises: "Controllers, services, modules, resolvers, guards, pipes and the rest of the file-suffix conventions.",
    routes: "From controller and method decorators, unless versioning or RouterModule would rewrite them.",
  },
  {
    name: "Express",
    recognises: "Routes, controllers, middleware, services and models, from the directories they sit in.",
    routes: "None. Express assembles routes at runtime, so none are shown.",
  },
  {
    name: "React",
    recognises: "Components, by whether a file returns JSX, and hooks, by name.",
    routes: "—",
  },
  {
    name: "Anything else",
    recognises: "Plain TypeScript or JavaScript: every import, plus test and config files.",
    routes: "—",
  },
];

const refusals: Array<{ title: string; reason: string }> = [
  {
    title: "It never guesses an edge.",
    reason:
      "A line exists because an import resolved to a real file. A graph that is ninety percent right is worse than none, because there is no telling which ten percent is wrong.",
  },
  {
    title: "The AI explains. It doesn't decide.",
    reason:
      "A model writes the explanation of a file and may label a file no convention identified. It is never asked whether two files are connected.",
  },
  {
    title: "It doesn't grade your code.",
    reason:
      "No scores, no severity, no issue counts. Once there's a number, people argue with the number instead of reading the map.",
  },
  {
    title: "It doesn't show approximate routes.",
    reason: "If a route's method and full path can't both be read from the syntax, there is no route rather than a likely one.",
  },
  {
    title: "It doesn't hide what it skipped.",
    reason: "Files it didn't parse and imports it couldn't resolve are counted, and each comes with the reason.",
  },
  {
    title: "It doesn't read private repositories.",
    reason: "That needs a token, and a token would then have to be stored. Public repositories only.",
  },
  {
    title: "It reads one language family.",
    reason: "TypeScript and JavaScript, because getting one genuinely right is the entire proposition.",
  },
];

export default async function Home() {
  const { isAuthenticated } = await auth();
  if (isAuthenticated) redirect("/workspace");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-(--node-divider) bg-background">
        <div className={`${column} flex h-14 items-center justify-between`}>
          <span className="font-mono text-sm font-semibold">cartograph</span>
          <div className="flex items-center gap-3">
            <ThemeControl />
            <Link className="font-mono text-xs text-(--text) hover:text-blue-600 dark:hover:text-blue-400" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className={`${column} grid min-h-[calc(100svh-3.5rem)] items-center gap-16 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20`}>
          <div className="min-w-0">
            <p className={eyebrow}>Dependency maps for TypeScript and JavaScript</p>
            <h1 className="mt-5 text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-(--text-strong)">
              See how a codebase fits together.
            </h1>
            <p className={`mt-6 max-w-[46ch] ${body}`}>
              Paste a public GitHub repository. Cartograph parses every file and draws what really imports what — folders as
              boxes, imports as lines between them.
            </p>
            <div className="mt-10 max-w-xl">
              <HeroForm />
              <p className="mt-3 font-mono text-[11px] text-(--text-muted)">Public repositories only · sign in to run an analysis</p>
            </div>
          </div>
          <div className="min-w-0">
            <MapFigure />
          </div>
        </section>

        <section className={section}>
          <div className={`${column} grid items-center gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-20`}>
            <div className="order-last min-w-0 lg:order-first">
              <SelectionFigure />
              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-(--text-muted)">
                <li className="flex items-center gap-2">
                  <span className="h-px w-5 bg-(--edge-in)" />
                  imported by
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-px w-5 bg-(--edge-out)" />
                  imports
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-5 border-t border-dashed border-(--edge-in) opacity-60" />
                  two steps out
                </li>
              </ul>
            </div>
            <div className="min-w-0">
              <p className={eyebrow}>What it does</p>
              <h2 className={`mt-4 ${heading}`}>Select a file. See what depends on it.</h2>
              <div className={`mt-6 flex max-w-[46ch] flex-col gap-5 ${body}`}>
                <p>
                  Folders fold into boxes and open into their files. Pick one and the map shows what it imports and what imports
                  it, in two colours, because direction is the whole reason to look at an edge.
                </p>
                <p>
                  Two steps out is the blast radius: every file that could break if this one changes. It&apos;s arithmetic over
                  the edge list, so it appears the moment you click.
                </p>
                <p>
                  Ask for an explanation and get a paragraph written from that file and its real neighbours, cached so the next
                  person to ask doesn&apos;t wait.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={section}>
          <div className={column}>
            <p className={eyebrow}>How it works</p>
            <h2 className={`mt-4 ${heading}`}>Parsed, not guessed.</h2>
            <p className={`mt-6 max-w-[64ch] ${body}`}>
              The map comes from the TypeScript compiler reading every file. A model is only asked to explain what the parser
              already found.
            </p>
            <div className="mt-16 max-w-205">
              <PipelineFigure />
            </div>
            <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-20">
              <li className="min-w-0">
                <p className="font-mono text-[11px] text-(--text-muted)">01 · fetch</p>
                <p className={`mt-3 max-w-[46ch] ${body}`}>
                  The default branch is downloaded at its latest commit, and that commit is recorded with the map. Progress shows
                  live while it runs.
                </p>
              </li>
              <li className="min-w-0">
                <p className="font-mono text-[11px] text-(--text-muted)">02 · parse</p>
                <p className={`mt-3 max-w-[46ch] ${body}`}>
                  Imports, re-exports, dynamic imports and <code className="font-mono text-[13px]">require()</code> become edges
                  only when they resolve to a real file. The rest are counted and reported.
                </p>
              </li>
              <li className="min-w-0">
                <p className="font-mono text-[11px] text-(--text-muted)">03 · draw</p>
                <p className={`mt-3 max-w-[46ch] ${body}`}>
                  Fan-in, fan-out and blast radius are arithmetic over the edges. The map belongs to your organization, so a
                  repository is mapped once and everyone starts from it.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section className={section}>
          <div className={column}>
            <p className={eyebrow}>Frameworks</p>
            <h2 className={`mt-4 ${heading}`}>Knows what a file is for.</h2>
            <p className={`mt-6 max-w-[64ch] ${body}`}>
              Framework knowledge lives in an adapter, picked from the repository&apos;s own manifest and config. It names what a
              file is and reads routes; it never adds an edge.
            </p>
            <div className="mt-16 border-b border-(--node-divider)">
              <div className="hidden gap-10 pb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-(--text-muted) md:grid md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
                <span>Adapter</span>
                <span>Recognises</span>
                <span>Routes</span>
              </div>
              {frameworks.map((framework) => (
                <div
                  className="grid gap-2 border-t border-(--node-divider) py-5 md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-10"
                  key={framework.name}
                >
                  <span className="font-mono text-sm font-semibold text-(--text-strong)">{framework.name}</span>
                  <p className="max-w-[46ch] text-sm leading-6 text-(--text)">{framework.recognises}</p>
                  <p className="max-w-[46ch] text-sm leading-6 text-(--text-muted)">{framework.routes}</p>
                </div>
              ))}
            </div>
            <p className={`mt-8 max-w-[64ch] ${body}`}>
              Files no convention identifies can be given a role by the model, from a short fixed list. It labels; it never
              connects.
            </p>
          </div>
        </section>

        <section className={section}>
          <div className={column}>
            <p className={eyebrow}>What it doesn&apos;t do</p>
            <h2 className={`mt-4 ${heading}`}>Everything here was left out on purpose.</h2>
            <p className={`mt-6 max-w-[64ch] ${body}`}>
              Each of these would make a better-looking demo. Each would make the map harder to trust.
            </p>
            <dl className="mt-16 border-b border-(--node-divider)">
              {refusals.map((refusal) => (
                <div className="grid gap-2 border-t border-(--node-divider) py-6 md:grid-cols-[20rem_minmax(0,1fr)] md:gap-20" key={refusal.title}>
                  <dt className="text-[15px] font-semibold leading-7 text-(--text-strong)">{refusal.title}</dt>
                  <dd className={`max-w-[64ch] ${body}`}>{refusal.reason}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-(--node-divider)">
        <div className={`${column} flex flex-col gap-2 py-10 font-mono text-[11px] text-(--text-muted) sm:flex-row sm:items-center sm:justify-between`}>
          <span>cartograph</span>
          <span>Public TypeScript and JavaScript repositories, mapped from their imports.</span>
        </div>
      </footer>
    </div>
  );
}
