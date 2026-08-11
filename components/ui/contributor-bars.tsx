import {
  contributorBarWidths,
  type ContributorSegment,
} from "@/components/ui/contributor-bars-helpers";

export type { ContributorSegment } from "@/components/ui/contributor-bars-helpers";

export interface ContributorBarsProps {
  segments: ContributorSegment[];
  /**
   * The shared scale every bar's width is measured against — e.g. `1` for a [0,1]-bounded total
   * (the Stability block's unrest floor), or a category's budget ceiling for a funding/labour-pool
   * caller. A segment's width is `value / total`, clamped to [0,100]% so a segment reading above
   * `total` (an uncapped contributor) still renders a full bar rather than overflowing the track.
   * The clamp is the TRACK's limit, not the reading's: the printed label carries the true
   * percentage, so a contributor at 2.4× the scale reads 240% beside its full bar and cannot be
   * mistaken for one sitting exactly at the ceiling. `total <= 0` renders every bar at 0% rather
   * than dividing by zero.
   */
  total: number;
}

/**
 * One horizontal bar per contributor, sharing one scale (`total`) so their relative sizes read at
 * a glance — the shared primitive for anywhere a number splits into several named causes (the
 * Stability block's goods/tax/crowding unrest floor today; labour pools, funding categories and
 * per-category treasury spend are the named future callers). Presentational only — no hooks, no
 * state — so it carries no `"use client"` directive.
 */
export function ContributorBars({ segments, total }: ContributorBarsProps) {
  const widths = contributorBarWidths(segments, total);

  return (
    <div className="space-y-1.5">
      {widths.map(({ label, color, pct, barPct }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-text-tertiary">{label}</span>
          <div className="relative h-1.5 flex-1 overflow-hidden bg-surface-active">
            <span className="block h-full" style={{ width: `${barPct}%`, background: color }} />
          </div>
          <span className="w-11 shrink-0 text-right font-mono text-xs text-text-secondary">
            {Math.round(pct)}%
          </span>
        </div>
      ))}
    </div>
  );
}
