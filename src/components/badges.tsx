import type { Category, RiskLevel, Severity } from "@/review/schema";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  nit: "bg-slate-100 text-slate-700 border-slate-200",
};

const RISK_STYLES: Record<RiskLevel, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-green-100 text-green-800 border-green-200",
};

const BADGE = "inline-block rounded border px-1.5 py-0.5 text-xs font-medium";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`${BADGE} ${SEVERITY_STYLES[severity]}`}>{severity}</span>;
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={`${BADGE} border-slate-200 bg-white text-slate-700`}>
      {category}
    </span>
  );
}

export function RiskBadge({ riskLevel }: { riskLevel: RiskLevel }) {
  return (
    <span className={`${BADGE} ${RISK_STYLES[riskLevel]}`}>
      {riskLevel} risk
    </span>
  );
}
