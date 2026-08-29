import type { PopNeedData } from "@/lib/types/api";
import { needSeverity, SEVERITY_GLYPH, SEVERITY_TEXT } from "@/components/system/needs-view";
import { UnmetNeedConsequences } from "@/components/system/unmet-need-consequences";

// Tier swatch colours match the dataviz-validated categorical set (base copper /
// technician deep-cyan / engineer purple) used elsewhere for consumer tiers.
const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;

/** The need popover's header `titleMeta` — the satisfaction figure that used to render inside this
 *  body's own `PopoverHeader`, now supplied by each call site to `PopoverContent`/
 *  `PopoverTriggerLabel` directly (the header region moved there — see `components/ui/popover.tsx`).
 *  Exported rather than duplicated at both consumers (`industry-panel.tsx`'s `ProblemLine`,
 *  `provision-block.tsx`'s `NeedRow`). */
export function NeedPopoverMeta({ need }: { need: PopNeedData }) {
  const severity = needSeverity(need.satisfaction);
  return (
    <span className={`whitespace-nowrap font-mono ${SEVERITY_TEXT[severity]}`}>
      {SEVERITY_GLYPH[severity]} {Math.round(need.satisfaction * 100)}% met
    </span>
  );
}

/** Canonical need-pressure popover body shared by population and industry surfaces. The header
 *  (good name + satisfaction figure) is no longer part of this body — it is supplied to the
 *  enclosing `PopoverContent`/`PopoverTriggerLabel` as `title`/`titleMeta` (`need.goodName` and
 *  `NeedPopoverMeta` above) by each call site instead. */
export function NeedPopoverBody({
  need,
}: {
  need: PopNeedData;
}) {
  const gap = need.want - need.delivered;

  return (
    <div className="space-y-1">
      <p className="whitespace-nowrap font-mono text-text-secondary">
        want {need.want.toFixed(2)}/cyc · delivered {need.delivered.toFixed(2)}/cyc · gap {gap.toFixed(2)}/cyc
      </p>
      <div className="space-y-0.5 overflow-x-auto border-t border-border/60 pt-1">
        {TIER_META.map((tier) => (
          <div key={tier.key} className="flex items-center justify-between gap-3 whitespace-nowrap">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden className="inline-block h-2 w-2" style={{ backgroundColor: tier.color }} /> {tier.label}
            </span>
            <span className="font-mono text-text-primary">{need.breakdown[tier.key].toFixed(2)}/cyc</span>
          </div>
        ))}
      </div>
      <UnmetNeedConsequences />
    </div>
  );
}
