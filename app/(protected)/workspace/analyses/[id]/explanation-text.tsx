import type { ReactNode } from "react";
import type { GraphGroup } from "@/lib/graph";

// Renders the only formatting the prompts permit — inline code, bullets, bold —
// into the pane. Everything else the model might emit is cleaned rather than
// shown: heading markers become plain text, code fences drop, unmatched
// backticks and asterisks are removed so no stray markup can appear.

type LinkContext = {
  filePaths: ReadonlySet<string>;
  groupByPath: ReadonlyMap<string, GraphGroup>;
  onRevealFile: (path: string) => void;
  onRevealGroup: (group: GraphGroup) => void;
};

const TOKEN = /[A-Za-z0-9_@.\-/[\]()]+/g;
const LEADING = /^[('"[<]/;
const TRAILING = /[.,;:)\]'">]$/;

function linkClass(extra?: string): string {
  return `font-mono text-[11px] leading-4 text-(--select) hover:underline ${extra ?? ""}`;
}

// A token is a link only when it names a real file or folded group exactly.
// Prose wraps paths in punctuation — "(see lib/foo.ts)." — so both ends are
// trimmed until it matches, and the trimmed characters stay rendered as plain
// text around the link rather than being swallowed.
function renderToken(token: string, context: LinkContext, key: string): ReactNode {
  let start = 0;
  let end = token.length;
  const matches = (value: string) => context.filePaths.has(value) || context.groupByPath.has(value);
  while (end > start && !matches(token.slice(start, end))) {
    if (TRAILING.test(token.slice(start, end))) {
      end -= 1;
    } else if (LEADING.test(token.slice(start, end))) {
      start += 1;
    } else {
      break;
    }
  }
  const candidate = token.slice(start, end);
  const group = context.groupByPath.get(candidate);
  const link = context.filePaths.has(candidate)
    ? () => context.onRevealFile(candidate)
    : group
      ? () => context.onRevealGroup(group)
      : null;
  if (link === null) return token;
  return (
    <span key={key}>
      {token.slice(0, start)}
      <button className={linkClass()} type="button" onClick={link}>
        {candidate}
      </button>
      {token.slice(end)}
    </span>
  );
}

function linkify(text: string, context: LinkContext, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(renderToken(match[0], context, `${keyPrefix}-${index}`));
    last = start + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Plain (non-code) text: **bold** pairs are extracted first, then any
// asterisks left over — unmatched by definition — are dropped with the paths
// still linkified.
function renderPlain(text: string, context: LinkContext, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      nodes.push(
        <strong className="font-semibold text-(--text-strong)" key={`${keyPrefix}-b${index}`}>
          {linkify(part, context, `${keyPrefix}-b${index}`)}
        </strong>,
      );
    } else {
      nodes.push(...linkify(part.replace(/\*/g, ""), context, `${keyPrefix}-p${index}`));
    }
  });
  return nodes;
}

function renderInline(text: string, context: LinkContext, keyPrefix: string): ReactNode[] {
  // An odd backtick count leaves one unmatched; dropping the last keeps it
  // from swallowing the rest of the line as a fake code span.
  let cleaned = text;
  if ((cleaned.match(/`/g) ?? []).length % 2 === 1) {
    const at = cleaned.lastIndexOf("`");
    cleaned = cleaned.slice(0, at) + cleaned.slice(at + 1);
  }

  const nodes: ReactNode[] = [];
  const parts = cleaned.split(/`([^`]*)`/g);
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      nodes.push(...renderPlain(part, context, `${keyPrefix}-${index}`));
      return;
    }
    const group = context.groupByPath.get(part);
    if (context.filePaths.has(part)) {
      nodes.push(
        <button className={linkClass()} key={`${keyPrefix}-c${index}`} type="button" onClick={() => context.onRevealFile(part)}>
          {part}
        </button>,
      );
    } else if (group) {
      nodes.push(
        <button className={linkClass()} key={`${keyPrefix}-c${index}`} type="button" onClick={() => context.onRevealGroup(group)}>
          {part}
        </button>,
      );
    } else {
      nodes.push(
        <code className="font-mono text-[11px] text-(--text-strong)" key={`${keyPrefix}-c${index}`}>
          {part}
        </code>,
      );
    }
  });
  return nodes;
}

const BULLET = /^[-*•]\s+/;

function renderBlock(block: string, context: LinkContext, keyPrefix: string): ReactNode {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  let prose: string[] = [];
  let part = 0;

  const flushProse = () => {
    if (prose.length === 0) return;
    out.push(
      <p className="font-mono text-[11px] leading-4 text-(--text)" key={`${keyPrefix}-t${part++}`}>
        {renderInline(prose.join(" "), context, `${keyPrefix}-t${part}`)}
      </p>,
    );
    prose = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul className="list-disc pl-4 font-mono text-[11px] leading-4 text-(--text)" key={`${keyPrefix}-u${part++}`}>
        {bullets.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, context, `${keyPrefix}-u${part}-${itemIndex}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of block.split("\n")) {
    if (raw.trimStart().startsWith("```")) continue;
    const line = raw.replace(/^#+\s*/, "");
    const trimmed = line.trimStart();
    if (BULLET.test(trimmed)) {
      flushProse();
      bullets.push(trimmed.replace(BULLET, ""));
    } else if (trimmed.length === 0) {
      flushProse();
      flushBullets();
    } else {
      flushBullets();
      prose.push(trimmed);
    }
  }
  flushProse();
  flushBullets();
  return out;
}

export function ExplanationText({ text, filePaths, groupByPath, onRevealFile, onRevealGroup }: LinkContext & { text: string }) {
  const context: LinkContext = { filePaths, groupByPath, onRevealFile, onRevealGroup };
  return (
    <div className="flex flex-col gap-2">
      {text.split(/\n\s*\n/).map((block, index) => (
        <div className="flex flex-col gap-1" key={index}>
          {renderBlock(block, context, `b${index}`)}
        </div>
      ))}
    </div>
  );
}
