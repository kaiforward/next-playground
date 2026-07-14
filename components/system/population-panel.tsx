"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import type { PopulationDemandEntry } from "@/lib/types/api";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PopulationSummary } from "@/components/system/population-summary";
import { demandBars, DEMAND_SERIES, DEMAND_TIERS, type DemandBar } from "@/components/system/demand-chart";

// Faint neutral hatch = the "market minimum" floor tail (consumption floored up to a tradeable minimum).
const FLOOR_HATCH = "repeating-linear-gradient(135deg, rgba(201,209,217,0.28) 0 2px, transparent 2px 5px)";

/** A swatch keyed to the demand palette (solid for a tier, hatched for the floor) — legend + tooltip share it. */
function DemandSwatch({ seriesKey, className = "" }: { seriesKey: DemandBar["segments"][number]["key"]; className?: string }) {
  const floor = seriesKey === "floor";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 align-middle ${floor ? "border border-border" : ""} ${className}`}
      style={floor ? { backgroundImage: FLOOR_HATCH } : { backgroundColor: DEMAND_SERIES[seriesKey].color }}
    />
  );
}

/** Always-present legend — the three consumer tiers plus the market-minimum floor. */
function DemandLegend() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-secondary">
      {DEMAND_TIERS.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <DemandSwatch seriesKey={k} /> {DEMAND_SERIES[k].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <DemandSwatch seriesKey="floor" /> {DEMAND_SERIES.floor.label}
      </span>
    </div>
  );
}

/** Per-bar hover tooltip: the good's total demand, then each segment's contribution. */
function DemandTooltip({ bar }: { bar: DemandBar }) {
  return (
    <dl className="space-y-0.5 text-xs">
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
        <dt className="font-display text-text-primary">{bar.goodName}</dt>
        <dd className="font-mono text-text-secondary">{bar.total.toFixed(2)}/cyc</dd>
      </div>
      {bar.segments.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-text-secondary">
            <DemandSwatch seriesKey={s.key} /> {DEMAND_SERIES[s.key].label}
          </dt>
          <dd className="font-mono text-text-primary">{s.value.toFixed(2)}/cyc</dd>
        </div>
      ))}
    </dl>
  );
}

/** One good = one stacked bar: name · segmented bar (base/tech/eng + floor tail) · total. */
function DemandBarRow({ bar }: { bar: DemandBar }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="flex items-center gap-2 outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <span className="w-24 shrink-0 truncate text-xs text-text-secondary" title={bar.goodName}>{bar.goodName}</span>
          <div className="relative h-3 flex-1 bg-surface-active">
            {/* the whole coloured region = this good's share of the biggest good (magnitude); internal splits = composition */}
            <div className="absolute inset-y-0 left-0 flex" style={{ width: `${bar.scale * 100}%` }}>
              {bar.segments.map((s, i) => (
                <div
                  key={s.key}
                  className={`h-full ${i > 0 ? "border-l-2 border-surface" : ""}`}
                  style={{
                    width: `${s.fraction * 100}%`,
                    backgroundColor: s.key === "floor" ? undefined : DEMAND_SERIES[s.key].color,
                    backgroundImage: s.key === "floor" ? FLOOR_HATCH : undefined,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs text-text-secondary">{bar.total.toFixed(2)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="w-52">
        <DemandTooltip bar={bar} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Consumer-segmented demand chart — one stacked bar per good, demand-sorted, base/tech/eng split visible. */
function DemandChart({ demand }: { demand: PopulationDemandEntry[] }) {
  const bars = demandBars(demand);
  return (
    <>
      <DemandLegend />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {bars.map((b) => (
          <DemandBarRow key={b.goodId} bar={b} />
        ))}
      </div>
    </>
  );
}

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="This system isn't developed yet — no established population." />
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
          What these inhabitants consume each economic cycle, split by consumer tier — this is what drives the system&apos;s market demand.
        </p>
        {demand.length === 0 ? (
          <EmptyState message="No demand." />
        ) : (
          <DemandChart demand={demand} />
        )}
      </Card>
    </div>
  );
}
