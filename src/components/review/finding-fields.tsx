import { INPUT } from "@/components/ui";
import { CATEGORIES, SEVERITIES } from "@/review/schema";

/**
 * The inputs for a finding a reviewer writes themselves. No state and no
 * handlers, only named fields, so the dashboard can put them in a form that
 * posts to a server action and the playground in one handled in the browser.
 */
export function FindingFields({ startLine }: { startLine: number }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-soft">
          Severity
          <select name="severity" defaultValue="warning" className={`mt-1 ${INPUT} w-32`}>
            {SEVERITIES.map((severity) => (
              <option key={severity}>{severity}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Category
          <select name="category" defaultValue="bug" className={`mt-1 ${INPUT} w-44`}>
            {CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Through line (optional)
          <input
            name="endLine"
            type="number"
            min={startLine}
            placeholder={String(startLine)}
            className={`mt-1 ${INPUT} w-28`}
          />
        </label>
      </div>
      <label className="mt-2 block text-xs text-ink-soft">
        What is wrong, and why it matters
        <textarea name="explanation" required rows={3} autoFocus maxLength={5000} className={`mt-1 ${INPUT}`} />
      </label>
      <label className="mt-2 block text-xs text-ink-soft">
        Suggested fix (optional)
        <textarea name="suggestedFix" rows={2} maxLength={5000} className={`mt-1 ${INPUT}`} />
      </label>
    </>
  );
}
