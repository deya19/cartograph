import {
  OrganizationSwitcher,
  UserButton,
} from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ThemeControl } from "@/components/theme-control";

export const instant = false;

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isAuthenticated, orgId, orgSlug } = await auth();

  if (!isAuthenticated) {
    redirect("/sign-in");
  }

  if (!orgId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="flex max-w-md flex-col items-center text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blue-600">
            Workspace required
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Choose a workspace</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Select an organization or create one to continue to Cartograph.
          </p>
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/workspace"
            afterSelectOrganizationUrl="/workspace"
            organizationProfileMode="modal"
          />
        </section>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <Link className="font-mono text-sm font-semibold" href="/workspace">
            cartograph
          </Link>
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/workspace"
            afterSelectOrganizationUrl="/workspace"
            hidePersonal
            organizationProfileMode="modal"
          />
          <span className="hidden font-mono text-xs text-zinc-500 sm:inline">
            {orgSlug ?? orgId}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeControl />
          <Link
            className="hidden font-mono text-xs text-zinc-500 hover:text-blue-600 sm:inline"
            href="/workspace/organization"
          >
            Team settings
          </Link>
          <UserButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
