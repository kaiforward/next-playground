"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { PopulationSummary } from "@/components/system/population-summary";

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to assess its population." />
    );
  }

  const { population, popCap, unrest, striking, demand } = pop;

  return (
    <div className="space-y-6">
      <Card variant="bordered" padding="md">
        <PopulationSummary population={population} popCap={popCap} />
      </Card>

      <Card variant="bordered" padding="md">
        <div className="mb-3 flex items-center justify-between">
          <SectionHeader as="h4">Stability</SectionHeader>
          <StabilityBadge unrest={unrest} />
        </div>
        <ProgressBar
          label="Stability"
          value={1 - unrest}
          max={1}
          color="copper"
          formatValue={(n) => n.toFixed(2)}
        />
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
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
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
