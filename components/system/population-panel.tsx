"use client";

import { useState } from "react";
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import type { PopNeedData } from "@/lib/types/api";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PopulationSummary } from "@/components/system/population-summary";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH, SEVERITY_TEXT } from "@/components/system/needs-view";
import { NeedCells, NeedsTable } from "@/components/system/needs-table";

// Tier swatch colours match the dataviz-validated categorical set (base copper /
// technician deep-cyan / engineer purple) used elsewhere for consumer tiers.
const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;

function NeedTooltip({ n }: { n: PopNeedData }) {
  const sev = needSeverity(n.satisfaction);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
        <span className="font-display text-text-primary">{n.goodName}</span>
        <span className={`font-mono ${SEVERITY_TEXT[sev]}`}>{SEVERITY_GLYPH[sev]} {Math.round(n.satisfaction * 100)}% met</span>
      </div>
      <p className="font-mono text-text-secondary">
        want {n.want.toFixed(2)}/cyc · delivered {n.delivered.toFixed(2)}/cyc · pressure {n.pressure.toFixed(2)}
      </p>
      <div className="space-y-0.5 border-t border-border/60 pt-1">
        {TIER_META.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden className="inline-block h-2 w-2" style={{ backgroundColor: t.color }} /> {t.label}
            </span>
            <span className="font-mono text-text-primary">{n.breakdown[t.key].toFixed(2)}/cyc</span>
          </div>
        ))}
      </div>
      <p className="border-t border-border/60 pt-1 text-text-secondary">Higher-pressure needs create more unrest.</p>
    </div>
  );
}

function NeedRow({ n }: { n: PopNeedData }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <tr tabIndex={0} className="border-b border-border/40 outline-none last:border-b-0 focus-visible:ring-1 focus-visible:ring-accent">
          <NeedCells n={n} density="panel" />
        </tr>
      </TooltipTrigger>
      <TooltipContent className="w-64"><NeedTooltip n={n} /></TooltipContent>
    </Tooltip>
  );
}

function NeedsLedger({ needs }: { needs: PopNeedData[] }) {
  const [expanded, setExpanded] = useState(false);
  const { problems, met } = splitNeedsLedger(needs);
  return (
    <NeedsTable density="panel">
      {problems.map((n) => <NeedRow key={n.goodId} n={n} />)}
      {met.length > 0 && !expanded && (
        <tr>
          <td colSpan={4} className="px-1.5 py-1.5 text-xs text-text-tertiary">
            <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-1.5 hover:text-text-secondary">
              <span aria-hidden className="font-mono text-[10px] text-status-green-light">✓</span>
              {met.length} needs met <span className="font-mono text-[10px]">▸ expand</span>
            </button>
          </td>
        </tr>
      )}
      {expanded && met.map((n) => <NeedRow key={n.goodId} n={n} />)}
    </NeedsTable>
  );
}

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="This system isn't developed yet — no established population." />
    );
  }

  const { population, popCap, unrest, striking, needs } = pop;

  // Uninhabited: no housing capacity → no population, no needs. The deposits are
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
        <SectionHeader as="h4" className="mb-1">Needs</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What the population consumes and how well each want is met — unmet needs drive unrest.
        </p>
        {needs.length === 0 ? (
          <EmptyState message="No needs." />
        ) : (
          <NeedsLedger needs={needs} />
        )}
      </Card>
    </div>
  );
}
