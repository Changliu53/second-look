import { CopyButton } from "@/components/copy-button";
import { SECTION_LABEL } from "@/components/ui";

/**
 * A fix prompt shown as copyable text. Open by default: it is text that is
 * about to be sent to someone, so the reviewer should see it without asking.
 * Long prompts scroll inside the block.
 */
export function FixPromptBlock({
  title,
  hint,
  prompt,
  open = true,
}: {
  title: string;
  hint: string;
  prompt: string;
  open?: boolean;
}) {
  return (
    <details open={open} className="rounded-lg border border-edge bg-surface-raised">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-2.5">
        <span className="min-w-0">
          <span className={`${SECTION_LABEL} mr-2`}>{title}</span>
          <span className="block text-xs text-ink-soft sm:inline">{hint}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <CopyButton text={prompt} label="Copy prompt" />
        </span>
      </summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-edge bg-slate-50 p-4 font-mono text-xs leading-relaxed">
        {prompt}
      </pre>
    </details>
  );
}
