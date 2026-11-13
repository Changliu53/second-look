import { Fragment } from "react";

/**
 * Renders the small subset of Markdown that our own published reviews use:
 * "## " headings, "- " list items, **bold**, _italic_ lines, and `code`.
 * It only ever receives text built by buildReviewPayload, so a full Markdown
 * library (and its HTML handling) is not needed. Everything is rendered as
 * React text nodes, never as raw HTML.
 */

/**
 * Text with `code` and **bold** rendered, and everything else left as is.
 * Used for finding explanations, where the model often quotes identifiers.
 */
export function InlineText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** and `code`, keeping the delimiters.
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-slate-100 px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function renderLine(line: string, index: number): React.ReactNode {
  const trimmed = line.trim();
  if (trimmed === "") {
    return <div key={index} className="h-2" />;
  }
  if (trimmed.startsWith("## ")) {
    return (
      <h4 key={index} className="text-base font-semibold tracking-tight">
        {renderInline(trimmed.slice(3))}
      </h4>
    );
  }
  if (trimmed.startsWith("- ")) {
    return (
      <p key={index} className="flex gap-2 pl-1">
        <span aria-hidden className="text-ink-soft">•</span>
        <span>{renderInline(trimmed.slice(2))}</span>
      </p>
    );
  }
  if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
    return (
      <p key={index} className="text-xs text-ink-soft">
        {renderInline(trimmed.slice(1, -1))}
      </p>
    );
  }
  return <p key={index}>{renderInline(line)}</p>;
}

export function MarkdownLite({ text }: { text: string }) {
  return <div className="space-y-1 text-sm leading-relaxed">{text.split("\n").map(renderLine)}</div>;
}
