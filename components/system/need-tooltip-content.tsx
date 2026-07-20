import type { PopNeedData } from "@/lib/types/api";
import { needSeverity, SEVERITY_GLYPH, SEVERITY_TEXT } from "@/components/system/needs-view";

const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;

/** Canonical need-pressure tooltip shared by population and industry surfaces. */
export function NeedTooltipContent({
  need,
}: {
  need: PopNeedData;
}) {
  const severity = needSeverity(need.satisfaction);
  const gap = need.want - need.delivered;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
        <span className="font-display text-text-primary">{need.goodName}</span>
        <span className={`font-mono ${SEVERITY_TEXT[severity]}`}>
          {SEVERITY_GLYPH[severity]} {Math.round(need.satisfaction * 100)}% met
        </span>
      </div>
      <p className="font-mono text-text-secondary">
        want {need.want.toFixed(2)}/cyc · delivered {need.delivered.toFixed(2)}/cyc · gap {gap.toFixed(2)}/cyc · pressure {need.pressure.toFixed(2)}
      </p>
      <div className="space-y-0.5 border-t border-border/60 pt-1">
        {TIER_META.map((tier) => (
          <div key={tier.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden className="inline-block h-2 w-2" style={{ backgroundColor: tier.color }} /> {tier.label}
            </span>
            <span className="font-mono text-text-primary">{need.breakdown[tier.key].toFixed(2)}/cyc</span>
          </div>
        ))}
      </div>
      <p className="border-t border-border/60 pt-1 text-text-secondary">Higher-pressure needs create more unrest.</p>
    </div>
  );
}
