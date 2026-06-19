"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { formatNumber } from "@/lib/utils/format";

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to assess its population." />
    );
  }

  const { population, popCap, unrest, striking, demand } = pop;
  const popCapInt = Math.round(popCap);
  // population and unrest are Floats; round the progress-bar readouts so the
  // "value / max" labels stay legible (e.g. 0.09 / 1, not 0.0943265… / 1).
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="space-y-6">
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-3">Population</SectionHeader>
        <StatList>
          <StatRow label="Inhabitants">
            <span className="font-mono text-sm text-text-primary">{formatNumber(population)}</span>
          </StatRow>
          <StatRow label="Capacity">
            <span className="font-mono text-sm text-text-primary">{formatNumber(popCapInt)}</span>
          </StatRow>
        </StatList>
        <ProgressBar label="Utilisation" value={round2(population)} max={Math.max(1, popCapInt)} color="copper" />
      </Card>

      <Card variant="bordered" padding="md">
        <div className="mb-3 flex items-center justify-between">
          <SectionHeader as="h4">Stability</SectionHeader>
          <StabilityBadge unrest={unrest} />
        </div>
        <ProgressBar label="Unrest" value={round2(unrest)} max={1} color="copper" />
        {striking && (
          <p className="mt-2 text-sm text-amber-300">Production suppressed — workers are striking.</p>
        )}
      </Card>

      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">Demand footprint</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What these inhabitants consume each tick — this is what drives the system&apos;s market demand.
        </p>
        {demand.length === 0 ? (
          <EmptyState message="No demand." />
        ) : (
          <ul className="space-y-1.5">
            {demand.map((d) => (
              <li key={d.goodId} className="flex items-center justify-between py-1.5 px-3 bg-surface">
                <span className="text-sm text-text-primary">{d.goodName}</span>
                <span className="text-sm font-mono text-text-secondary">{d.demandRate.toFixed(2)}/t</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
