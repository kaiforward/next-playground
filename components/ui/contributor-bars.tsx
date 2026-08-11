import { clamp } from "@/lib/utils/math";

/** One contributor's raw value plus its display label and paint colour. */
export interface ContributorSegment {
  label: string;
  value: number;
  color: string;
}

export interface ContributorBarsProps {
  segments: ContributorSegment[];
  /**
   * The shared scale every bar's width is measured against — e.g. `1` for a [0,1]-bounded total
   * (the Stability block's unrest floor), or a category's budget ceiling for a funding/labour-pool
   * caller. A segment's width is `value / total`, clamped to [0,100]% so a segment reading above
   * `total` (an uncapped contributor) still renders a full bar rather than overflowing the track.
   * `total <= 0` renders every bar at 0% rather than dividing by zero.
   */
  total: number;
  /**
   * Optional marker value, on the same scale as `total` — rendered as a vertical tick across every
   * bar's track (e.g. the strike threshold on the unrest scale). No caption is drawn on the marker
   * itself; the caller supplies that in prose, since one shared line naming the value already reads
   * better than repeating it once per bar.
   */
  threshold?: number;
}

/**
 * One horizontal bar per contributor, sharing one scale (`total`) so their relative sizes read at
 * a glance — the shared primitive for anywhere a number splits into several named causes (the
 * Stability block's goods/tax/crowding unrest floor today; labour pools, funding categories and
 * per-category treasury spend are the named future callers). Presentational only — no hooks, no
 * state — so it carries no `"use client"` directive.
 */
export function ContributorBars({ segments, total, threshold }: ContributorBarsProps) {
  const thresholdPct =
    threshold !== undefined && total > 0 ? clamp((threshold / total) * 100, 0, 100) : undefined;

  return (
    <div className="space-y-1.5">
      {segments.map((segment) => {
        const pct = total > 0 ? clamp((segment.value / total) * 100, 0, 100) : 0;
        return (
          <div key={segment.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-text-tertiary">{segment.label}</span>
            <div className="relative h-1.5 flex-1 overflow-hidden bg-surface-active">
              <span className="block h-full" style={{ width: `${pct}%`, background: segment.color }} />
              {thresholdPct !== undefined && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-text-primary/60"
                  style={{ left: `${thresholdPct}%` }}
                />
              )}
            </div>
            <span className="w-9 shrink-0 text-right font-mono text-xs text-text-secondary">
              {Math.round(pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ContributorBreakdownProps extends ContributorBarsProps {
  /**
   * The headline total these segments break down — on the exact same scale as `total`/`threshold`
   * (e.g. the Stability block's actual unrest reading, not the settled sum the segments happen to
   * add up to, and never its stability-flavoured inverse). Kept as a raw value rather than a
   * pre-formatted string so it shares the identical clamp-and-round math the bars themselves use —
   * the printed number and the bars can never disagree about how a value maps to a percentage.
   */
  value: number;
}

/**
 * A headline total rendered above its `ContributorBars` breakdown, bundled as one component so a
 * caller — the Stability block today, a future tooltip — gets the number and its breakdown
 * together and never reassembles or re-derives one without the other. Presentational only, same
 * no-hooks / no-`"use client"` contract as `ContributorBars`.
 */
export function ContributorBreakdown({ value, ...bars }: ContributorBreakdownProps) {
  const pct = bars.total > 0 ? clamp((value / bars.total) * 100, 0, 100) : 0;
  return (
    <div className="space-y-2">
      <div className="font-mono text-2xl text-text-primary">{Math.round(pct)}%</div>
      <ContributorBars {...bars} />
    </div>
  );
}
