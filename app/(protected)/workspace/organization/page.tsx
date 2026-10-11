import { OrganizationProfile } from "@clerk/nextjs";

export default function OrganizationPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-blue-600">
          Team settings
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Organization</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Switch organizations or invite teammates from the organization controls.
        </p>
      </div>
      <OrganizationProfile routing="hash" />
    </section>
  );
}
