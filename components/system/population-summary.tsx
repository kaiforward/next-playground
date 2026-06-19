import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatHeadcount, formatHeadcountShort } from "@/lib/utils/format";

/**
 * Population / Capacity / Utilisation block as bare inner content (no Card or
 * section header — each consumer frames it). Values are realistic headcounts
 * derived from the abstract population Float. Callers pass the already-narrowed
 * visible values from useSystemPopulation.
 */
export function PopulationSummary({
  population,
  popCap,
}: {
  population: number;
  popCap: number;
}) {
  return (
    <div className="space-y-3">
      <StatList>
        <StatRow label="Population">
          <span className="font-mono text-sm text-text-primary">
            {formatHeadcount(population)}
          </span>
        </StatRow>
        <StatRow label="Capacity">
          <span className="font-mono text-sm text-text-primary">
            {formatHeadcount(popCap)}
          </span>
        </StatRow>
      </StatList>
      <ProgressBar
        label="Utilisation"
        value={population}
        max={Math.max(1, popCap)}
        color="copper"
        formatValue={formatHeadcountShort}
      />
    </div>
  );
}
