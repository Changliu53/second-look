import type { ReactNode } from "react";

const SIDES = { top: "bottom-full mb-2", bottom: "top-full mt-2" };
const ALIGNS = { start: "left-0", end: "right-0" };

/**
 * Shows why a control is unavailable while the pointer is over it. The
 * wrapper carries the tooltip because a disabled button fires no mouse
 * events of its own, and the native `title` tooltip takes over a second to
 * appear. With no reason it renders the control and nothing else.
 */
export function ReasonTip({
  reason,
  side = "top",
  align = "start",
  children,
}: {
  reason: string | null;
  side?: keyof typeof SIDES;
  align?: keyof typeof ALIGNS;
  children: ReactNode;
}) {
  if (!reason) {
    return <>{children}</>;
  }
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-30 w-max max-w-64 rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition group-hover/tip:opacity-100 ${SIDES[side]} ${ALIGNS[align]}`}
      >
        {reason}
      </span>
    </span>
  );
}
