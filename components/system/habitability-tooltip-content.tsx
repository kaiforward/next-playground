import type { FillOrderRow } from "@/lib/utils/substrate";

/**
 * The Population tab's growth-multiplier decomposition — every people-land-contributing body in
 * fill-best-first (score-descending) order, so quality is always shown as a story about bodies
 * (spec §3), never a bare number. The marginal body (the fold's `frontierIndex`) is marked
 * "Frontier" — the partially- or newly-occupied body whose share alone can be less than fully
 * counted; every body before it in the list is fully occupied, every body after it is untouched.
 */
export function HabitabilityTooltipContent({ fillOrder }: { fillOrder: FillOrderRow[] }) {
  if (fillOrder.length === 0) {
    return <p className="text-xs text-text-secondary">No people-land bodies yet.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="border-b border-border/60 pb-1 text-text-secondary">
        Growth quality is the people-land-weighted mean score of the bodies this population
        currently occupies, best world first.
      </p>
      <ul className="space-y-0.5">
        {fillOrder.map((row, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 ${row.occupied ? "bg-status-green" : "bg-surface-active"}`}
              />
              {row.className}
              {row.frontier && <span className="text-text-tertiary">— Frontier</span>}
            </span>
            <span className="font-mono text-text-primary">{row.score.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
