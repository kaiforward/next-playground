"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import type { ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PopulationSummary } from "@/components/system/population-summary";

/** Composition rows in display order — only non-zero terms are shown. */
const BREAKDOWN_ROWS: Array<{ key: keyof ConsumptionBreakdown; label: string }> = [
  { key: "base", label: "Base population" },
  { key: "technicians", label: "Technicians" },
  { key: "engineers", label: "Engineers" },
];

/** Demand-composition tooltip body: which contributors make up this good's demand rate. */
function DemandBreakdownBody({ breakdown, demandRate }: { breakdown: ConsumptionBreakdown; demandRate: number }) {
  const rows = BREAKDOWN_ROWS.filter((r) => breakdown[r.key] > 0);
  // demandRate is floored at a minimum tradeable demand server-side, so on tiny
  // systems the terms can sum below it (or all be zero). Name the floor rather
  // than showing a breakdown that doesn't add up — the scaled floor constant is
  // server-only, so the gap is detected from the served numbers.
  const sum = breakdown.base + breakdown.technicians + breakdown.engineers;
  const floored = demandRate - sum > demandRate * 1e-6;
  return (
    <div className="space-y-0.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-secondary">{r.label}</span>
          <span className="font-mono text-[10px] text-text-primary">{breakdown[r.key].toFixed(2)}/cyc</span>
        </div>
      ))}
      {floored && (
        <p className="text-[10px] text-text-tertiary">
          {rows.length === 0
            ? "No local consumption — the shown rate is the market's minimum tradeable demand."
            : "Consumption is below the market's minimum tradeable demand; the shown rate is that floor."}
        </p>
      )}
    </div>
  );
}

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to assess its population." />
    );
  }

  const { population, popCap, unrest, striking, demand } = pop;

  // Uninhabited: no housing capacity → no population, no demand. The deposits are
  // still charted on the Astrography tab (the colonisation hook).
  if (popCap <= 0) {
    return (
      <EmptyState message="Uninhabited — no population is established here. This system's deposits are charted on the Astrography tab." />
    );
  }

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
          What these inhabitants consume each economic cycle — this is what drives the system&apos;s market demand.
        </p>
        {demand.length === 0 ? (
          <EmptyState message="No demand." />
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {demand.map((d) => (
              <li key={d.goodId} className="flex items-center justify-between py-1.5 px-3 bg-surface">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-left text-sm text-text-primary underline-offset-2 hover:underline">
                      {d.goodName}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="w-52">
                    <DemandBreakdownBody breakdown={d.breakdown} demandRate={d.demandRate} />
                  </TooltipContent>
                </Tooltip>
                <span className="text-sm font-mono text-text-secondary">{d.demandRate.toFixed(2)}/cyc</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
