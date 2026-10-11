import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ThemeControl } from "@/components/theme-control";

export const instant = false;

export default async function Home() {
  const { isAuthenticated } = await auth();

  if (isAuthenticated) {
    redirect("/workspace");
  }

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-emerald-400 font-mono text-sm font-bold text-zinc-950">
            C
          </div>
          <span className="font-mono text-sm font-semibold tracking-wide">
            cartograph
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeControl />
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="rounded-md px-3 py-2 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="rounded-md bg-emerald-400 px-3 py-2 font-mono text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-300">
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-24 lg:px-10">
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.24em] text-emerald-400">
          Repository intelligence
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-white sm:text-7xl">
          See how your codebase fits together.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-zinc-400">
          Cartograph parses a public GitHub repository and turns its real file
          dependencies into a map you can explore.
        </p>
        <div className="mt-10 flex items-center gap-3">
          <Show when="signed-out">
            <SignUpButton mode="modal">
              <button className="rounded-md bg-emerald-400 px-5 py-3 font-mono text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300">
                Create an account
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link
              className="rounded-md bg-emerald-400 px-5 py-3 font-mono text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300"
              href="/workspace"
            >
              Map a repository
            </Link>
          </Show>
        </div>
      </section>
    </main>
  );
}
