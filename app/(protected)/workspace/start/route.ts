import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after, type NextRequest } from "next/server";
import { parseGitHubUrl } from "@/lib/pipeline/github-url.ts";
import { runAnalysis, startAnalysis } from "@/lib/pipeline/index.ts";

// The landing page's hero submits here by GET, because the URL has to survive
// the trip through sign-in: the proxy protects /workspace and sends the
// visitor back to this exact address, query included. A GET that starts work
// is safe here only because startAnalysis returns the existing row for a
// repository the organization already has, so a reload creates nothing new.
export async function GET(request: NextRequest) {
  const { orgId } = await auth();
  const url = request.nextUrl.searchParams.get("url")?.trim() ?? "";

  // Without an organization the workspace shows its chooser; without a valid
  // URL the workspace form is where it gets corrected.
  if (!orgId || !parseGitHubUrl(url)) redirect("/workspace");

  const { analysisId, existing } = await startAnalysis(orgId, url);
  if (!existing) {
    after(() => runAnalysis(analysisId).catch((error: unknown) => console.error("Analysis run failed:", error)));
  }
  redirect(`/workspace/analyses/${analysisId}`);
}
