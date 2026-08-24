import type { FillOrderRow } from "@/lib/utils/substrate";

/**
 * The Population tab's growth-multiplier decomposition — headline habitability stat, the population
 * growth modifier it produces, then every habitable-land-contributing body in fill-best-first
 * (score-descending) order, so quality is always shown as a story about bodies (spec §3), never a
 * bare number. The marginal body — the one only partly counted, still filling — is marked "Partial";
 * every body before it in the list is fully occupied, every body after it is untouched.
 */
export function HabitabilityTooltipContent({
  growthMultiplier,
  fillOrder,
}: {
  growthMultiplier: number;
  fillOrder: FillOrderRow[];
}) {
  const habitabilityPct = Math.round(growthMultiplier * 100);
  const growthModifier = Math.round((growthMultiplier - 1) * 100);
  const growthModifierText = `${growthModifier >= 0 ? "+" : "−"}${Math.abs(growthModifier)}%`;

  if (fillOrder.length === 0) {
    return <p className="text-xs text-text-secondary">No habitable-land bodies yet.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="font-mono text-text-primary">Habitability: {habitabilityPct}%</p>
      <p className="font-mono text-text-secondary">Population growth: {growthModifierText}</p>
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
              {row.className}
              {row.frontier && <span className="text-text-tertiary">— Partial</span>}
            </span>
            <span className="font-mono text-text-primary">{Math.round(row.score * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
