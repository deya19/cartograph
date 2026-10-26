// Fetches a public GitHub repo's archive into a temp dir and parses it with
// the same selectFiles/parseSelection the pipeline uses — eval datasets are
// built from real parser output, not a fixture.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchArchive, parseGitHubUrl } from "../lib/pipeline/github.ts";
import { parseSelection, selectFiles } from "../lib/parser/index.ts";
import type { FileRecord, ParseResult } from "../lib/parser/types.ts";

export type ParsedRepo = {
  directory: string;
  repository: string;
  commit: string;
  result: ParseResult;
  readSource: (file: FileRecord) => Promise<string>;
};

export async function withParsedRepo<T>(url: string, fn: (repo: ParsedRepo) => Promise<T>): Promise<T> {
  const repo = parseGitHubUrl(url);
  if (!repo) throw new Error(`Not a GitHub repository URL: ${url}`);

  const directory = await mkdtemp(path.join(tmpdir(), "cartograph-eval-"));
  try {
    const archive = await fetchArchive(repo.owner, repo.repo, directory);
    const result = await parseSelection(await selectFiles(directory));
    return await fn({
      directory,
      repository: archive.fullName,
      commit: archive.sha,
      result,
      readSource: (file) => readFile(path.join(directory, file.path), "utf8"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
