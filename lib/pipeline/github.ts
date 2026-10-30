import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import * as tar from "tar";
import type { GitHubRepo } from "./github-url.ts";

export { parseGitHubUrl, type GitHubRepo } from "./github-url.ts";

// Lowercased because GitHub is case-insensitive — this is the dedupe key.
export function canonicalUrl({ owner, repo }: GitHubRepo): string {
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export type FetchedArchive = {
  sha: string;
  defaultBranch: string;
  fullName: string;
  notExtracted: Array<{ path: string; type: string }>;
};

const maxArchiveBytes = 100 * 1024 * 1024;

const apiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cartograph",
};

const HEAD_SHA_CACHE_TTL_MS = 30_000;
const HEAD_SHA_CACHE_LIMIT = 256;
const headShaCache = new Map<string, { promise: Promise<string>; expiresAt: number }>();

function rateLimitError(response: Response): Error | null {
  const limited = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
  if (!limited) return null;
  const reset = response.headers.get("x-ratelimit-reset");
  const when = reset ? new Date(Number(reset) * 1000).toISOString() : "later";
  return new Error(`GitHub API rate limit reached; try again after ${when}`);
}

// One file's raw content at a ref. Decoded with ignoreBOM: readFile("utf8")
// keeps a leading U+FEFF and the parser hashes that string, so stripping the
// BOM here would break the content-hash comparison.
export async function fetchRawFile(owner: string, repo: string, ref: string, path: string): Promise<{ status: number; text: string | null }> {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodedPath}`);
  if (!response.ok) return { status: response.status, text: null };
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
  return { status: response.status, text };
}

// HEAD of the default branch as a bare sha — the staleness check compares it
// against the analysed commit.
export async function fetchHeadSha(owner: string, repo: string, defaultBranch: string): Promise<string> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}/${defaultBranch}`;
  const now = Date.now();
  const cached = headShaCache.get(key);
  if (cached && cached.expiresAt > now) {
    headShaCache.delete(key);
    headShaCache.set(key, cached);
    return cached.promise;
  }

  headShaCache.delete(key);
  const promise = (async () => {
    const shaResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${defaultBranch}`, {
      headers: { Accept: "application/vnd.github.sha", "User-Agent": "cartograph" },
    });
    const rateLimited = rateLimitError(shaResponse);
    if (rateLimited) throw rateLimited;
    if (!shaResponse.ok) {
      throw new Error(`Could not resolve ${owner}/${repo}@${defaultBranch}: GitHub API error ${shaResponse.status}`);
    }
    return (await shaResponse.text()).trim();
  })();
  const entry = { promise, expiresAt: now + HEAD_SHA_CACHE_TTL_MS };
  headShaCache.set(key, entry);
  while (headShaCache.size > HEAD_SHA_CACHE_LIMIT) {
    const oldestKey = headShaCache.keys().next().value;
    if (oldestKey === undefined) break;
    headShaCache.delete(oldestKey);
  }

  try {
    return await promise;
  } catch (error) {
    if (headShaCache.get(key) === entry) headShaCache.delete(key);
    throw error;
  }
}

// Resolves the repo's default branch to a commit sha, then downloads and
// extracts exactly that commit's archive into dest. Entries that are not
// regular files or directories (symlinks, links) are reported instead of
// extracted, so nothing vanishes uncounted.
export async function fetchArchive(owner: string, repo: string, dest: string): Promise<FetchedArchive> {
  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: apiHeaders });
  if (repoResponse.status === 404) {
    throw new Error(`Repository not found on GitHub, or it is private: ${owner}/${repo}`);
  }
  const rateLimited = rateLimitError(repoResponse);
  if (rateLimited) throw rateLimited;
  if (!repoResponse.ok) {
    throw new Error(`GitHub API error ${repoResponse.status} for ${owner}/${repo}`);
  }
  const metadata: { default_branch?: string; full_name?: string } = await repoResponse.json();
  if (!metadata.default_branch || !metadata.full_name) {
    throw new Error(`Unexpected GitHub response for ${owner}/${repo}`);
  }
  const { default_branch: defaultBranch, full_name: fullName } = metadata;

  const sha = await fetchHeadSha(owner, repo, defaultBranch);

  const archive = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`, {
    headers: { "User-Agent": "cartograph" },
  });
  if (!archive.ok || !archive.body) {
    throw new Error(`Archive download failed for ${fullName}@${sha}: HTTP ${archive.status}`);
  }

  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      callback(seen > maxArchiveBytes ? new Error("Archive exceeds the 100 MB limit") : null, chunk);
    },
  });

  const notExtracted: Array<{ path: string; type: string }> = [];
  let extractedBytes = 0;
  let extractionError: Error | null = null;
  // Readable.fromWeb takes a stream/web ReadableStream while fetch() returns
  // undici's; pumping the reader by hand avoids casting between the two.
  const reader = archive.body.getReader();
  const source = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        this.push(done ? null : Buffer.from(value));
      } catch (error) {
        this.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  await pipeline(
    source,
    counter,
    tar.x({
      cwd: dest,
      strip: 1,
      filter: (entryPath, entry) => {
        // tar's filter entry is Stats when reading from a file path argument;
        // piping always produces a ReadEntry, which carries the tar type.
        const type = "type" in entry ? entry.type : "File";
        if (type === "File") {
          extractedBytes += entry.size;
          if (extractedBytes > maxArchiveBytes) {
            extractionError = new Error("Extracted archive exceeds the 100 MB limit");
            source.destroy(extractionError);
            return false;
          }
          return true;
        }
        if (type === "Directory") return true;
        notExtracted.push({ path: entryPath.split("/").slice(1).join("/"), type });
        return false;
      },
    }),
  );
  if (extractionError) throw extractionError;

  return { sha, defaultBranch, fullName, notExtracted };
}
