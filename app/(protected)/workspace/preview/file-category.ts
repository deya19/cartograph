import type { FileRecord } from "@/lib/parser/types";

export type Selection = { kind: "module"; id: string } | { kind: "file"; path: string } | null;

export type Hover = { kind: "file"; path: string } | { kind: "module"; id: string } | null;

export type FileCategory = { name: string; color: string };

// Colour means file kind (project doc §colour); anything unmapped is grey.
const EXTENSION_FAMILIES: Record<string, FileCategory> = {
  ".ts": { name: "TS", color: "var(--kind-ts)" },
  ".mts": { name: "TS", color: "var(--kind-ts)" },
  ".cts": { name: "TS", color: "var(--kind-ts)" },
  ".tsx": { name: "TSX", color: "var(--kind-tsx)" },
  ".js": { name: "JS", color: "var(--kind-js)" },
  ".mjs": { name: "JS", color: "var(--kind-js)" },
  ".cjs": { name: "JS", color: "var(--kind-js)" },
  ".jsx": { name: "JSX", color: "var(--kind-jsx)" },
};

export function fileCategory(extension: string): FileCategory {
  return EXTENSION_FAMILIES[extension] ?? {
    name: extension.replace(/^\./, "").toUpperCase() || "OTHER",
    color: "var(--kind-other)",
  };
}

export function fileCategories(files: FileRecord[]): Array<FileCategory & { count: number }> {
  const counts = new Map<string, FileCategory & { count: number }>();
  for (const file of files) {
    const category = fileCategory(file.extension);
    const entry = counts.get(category.name) ?? { ...category, count: 0 };
    entry.count += 1;
    counts.set(category.name, entry);
  }

  return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name));
}
