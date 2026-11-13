import type { Category, RiskLevel, Severity } from "@/review/schema";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-50 text-red-800 ring-red-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  nit: "bg-slate-100 text-slate-700 ring-slate-200",
};

const RISK_STYLES: Record<RiskLevel, string> = {
  high: "bg-red-50 text-red-800 ring-red-200",
  medium: "bg-amber-50 text-amber-900 ring-amber-200",
  low: "bg-green-50 text-green-800 ring-green-200",
};

const BADGE =
  "inline-flex items-center rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide ring-1 ring-inset";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`${BADGE} ${SEVERITY_STYLES[severity]}`}>{severity}</span>;
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.6875rem] text-slate-700 ring-1 ring-inset ring-edge">
      {category}
    </span>
  );
}

export function RiskBadge({ riskLevel }: { riskLevel: RiskLevel }) {
  return <span className={`${BADGE} ${RISK_STYLES[riskLevel]}`}>{riskLevel} risk</span>;
}
