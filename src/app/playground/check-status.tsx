import { SECTION_LABEL } from "@/components/ui";
import type { CheckRunUpdate } from "@/github/client";

const CONCLUSION_STYLES: Record<string, string> = {
  action_required: "border-red-200 bg-red-50 text-red-900",
  success: "border-green-200 bg-green-50 text-green-900",
};

// A check that is still running: neither passed nor failed.
const IN_PROGRESS_STYLE = "border-amber-200 bg-amber-50 text-amber-950";

/**
 * The Second Look check as GitHub shows it on the pull request. The text
 * comes from `checkRunFor`, the function the real app uses, so the playground
 * cannot drift from what is posted.
 */
export function CheckStatus({ check }: { check: CheckRunUpdate }) {
  const style =
    check.status === "in_progress"
      ? IN_PROGRESS_STYLE
      : (CONCLUSION_STYLES[check.conclusion ?? ""] ?? "border-edge");
  return (
    <div className={`rounded-lg border p-3 text-sm ${style}`}>
      <p className={SECTION_LABEL}>Check on the pull request</p>
      <p className="mt-1 font-semibold">
        Second Look: {check.title}
        {check.status === "in_progress" && <span className="font-normal"> (in progress)</span>}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed opacity-90">{check.summary}</p>
    </div>
  );
}
