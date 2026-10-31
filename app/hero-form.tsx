"use client";

import { useState, type FormEvent } from "react";
import { RepositoryUrlField } from "@/components/repository-url-field";
import { parseGitHubUrl } from "@/lib/pipeline/github-url.ts";

export function HeroForm() {
  const [error, setError] = useState<string | null>(null);

  // Checked before leaving the page, so nobody signs in only to be told the
  // URL was wrong. The server checks again; this is a courtesy, not the gate.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    if (parseGitHubUrl(url)) return;
    event.preventDefault();
    setError("Not a GitHub repository URL");
  }

  return (
    <form action="/workspace/start" method="get" onSubmit={handleSubmit}>
      <RepositoryUrlField error={error} />
    </form>
  );
}
