import { TermLabel } from "@/components/ui/term-label";
import type { FillOrderRow } from "@/lib/utils/substrate";

/**
 * The habitability decomposition, shown behind the figure on both the Population and Astrography
 * tabs — the headline stat, then every habitable-land-contributing body in fill-best-first
 * (score-descending) order, so quality is always shown as a story about bodies (spec §3), never a
 * bare number.
 *
 * The multiplier is stated once, as habitability. It is NOT also restated as a growth modifier:
 * that was the same number written twice ("87%" and "−13%"), and the second reading told a
 * temperate world it had "0%" population growth when it meant no penalty. The prose below the stat
 * carries the growth connection instead. The marginal body is marked "Partial" only when it is genuinely mid-fill (`partial`)
 * — a saturated system's last body and a zero-population system's first body both name a marginal
 * body without either being partially filled, so neither carries the label. Every body before the
 * marginal one is fully occupied, every body after it is untouched.
 */
export function HabitabilityPopoverBody({
  growthMultiplier,
  fillOrder,
}: {
  growthMultiplier: number;
  fillOrder: FillOrderRow[];
}) {
  const habitabilityPct = Math.round(growthMultiplier * 100);

  if (fillOrder.length === 0) {
    return <p className="text-xs text-text-secondary">No habitable-land bodies yet.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="font-mono text-text-primary">Habitability: {habitabilityPct}%</p>
      <p className="border-b border-border/60 pb-1 text-text-secondary">
        Settlers fill the best land first, so growth slows as a system fills toward its poorer land.
      </p>
      <ul className="space-y-0.5">
        {fillOrder.map((row, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 ${row.occupied ? "bg-status-green" : "bg-surface-active"}`}
              />
              <TermLabel id="archetype">{row.className}</TermLabel>
              {row.partial && <span className="text-text-tertiary">— Partial</span>}
            </span>
            <span className="font-mono text-text-primary">{Math.round(row.score * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
