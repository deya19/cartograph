// Kept apart from the archive fetcher so the landing page can check a URL in
// the browser without bundling node:stream and tar — this file imports nothing.
export type GitHubRepo = {
  owner: string;
  repo: string;
};

// Accepts a github.com URL in any of its casual forms (scheme optional, www,
// .git suffix, trailing slash, extra path like /tree/main) or a bare
// owner/repo shorthand.
export function parseGitHubUrl(input: string): GitHubRepo | null {
  const trimmed = input.trim();
  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(trimmed) ??
    // GitHub owners are alphanumeric-plus-hyphen, so forbidding dots keeps
    // "gitlab.com/x" from reading as a bare shorthand.
    /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)\/?$/i.exec(trimmed);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}
