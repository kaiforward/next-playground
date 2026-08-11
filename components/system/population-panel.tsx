"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { ContributorBreakdown, type ContributorSegment } from "@/components/ui/contributor-bars";
import { PopulationSummary } from "@/components/system/population-summary";
import { ProvisionBlock } from "@/components/system/provision-block";
import { fractionPct } from "@/lib/utils/format";
import type { SystemUnrestRead } from "@/lib/types/api";

/**
 * Which state the Population tab renders for a given population/housing/unrest reading — the pure
 * seam so the "is this system genuinely uninhabited" decision has a red-proofable assertion, not
 * just a rendered snapshot. A `popCap <= 0` system is a real, renderable state (collapsed housing
 * stranding its residents, per §6) whenever it still has residents or standing unrest; only a
 * system with neither is the true empty case.
 */
export function populationPanelView(pop: {
  population: number;
  popCap: number;
  unrest: number;
}): "uninhabited" | "populated" {
  if (pop.popCap <= 0 && pop.population <= 0 && pop.unrest <= 0) return "uninhabited";
  return "populated";
}

/**
 * Stability — the unrest chip, then a `ContributorBreakdown` (goods shortfall, tax pressure,
 * crowding, headed by the total) over the strike-threshold caption. The caption reads
 * `strikeThreshold` straight off the read (never a re-imported constant), so it and the badge's
 * own "Strike" label — bound to the same `STRIKE_PARAMS.threshold` — can never name different
 * numbers.
 *
 * The headline total is `unrest` — the same actual, current-tick value the badge label and
 * `striking` are computed from — not `unrestBreakdown.settled` (the contributors' capped sum,
 * which is only where unrest is *heading*; the accumulator lags behind it) and not a
 * stability-flavoured `1 - unrest` (which would move opposite to bars that are scaled on unrest,
 * not stability). Sharing `unrest` with the badge means the number and the word beside it can
 * never disagree; sharing the unrest scale with the bars means the number and their fill can never
 * point in opposite directions.
 */
export function StabilityBlock({
  unrest,
  striking,
  unrestBreakdown,
}: {
  unrest: number;
  striking: boolean;
  unrestBreakdown: SystemUnrestRead;
}) {
  const segments: ContributorSegment[] = unrestBreakdown.assessed
    ? [
        { label: "Goods shortfall", value: unrestBreakdown.contributors.goods, color: "var(--color-status-amber)" },
        { label: "Tax pressure", value: unrestBreakdown.contributors.tax, color: "var(--color-status-blue)" },
        { label: "Crowding", value: unrestBreakdown.contributors.crowding, color: "var(--color-status-purple)" },
      ]
    : [
        { label: "Tax pressure", value: unrestBreakdown.contributors.tax, color: "var(--color-status-blue)" },
        { label: "Crowding", value: unrestBreakdown.contributors.crowding, color: "var(--color-status-purple)" },
      ];

  return (
    <Card variant="bordered" padding="md">
      <div className="mb-3 flex items-center justify-between">
        <SectionHeader as="h4">Stability</SectionHeader>
        <StabilityBadge unrest={unrest} />
      </div>
      <ContributorBreakdown value={unrest} segments={segments} total={1} threshold={unrestBreakdown.strikeThreshold} />
      <p className="mt-2 text-xs text-text-tertiary">Strike at {fractionPct(unrestBreakdown.strikeThreshold)}%.</p>
      {striking && (
        <p className="mt-2 text-sm text-amber-300">Production suppressed — workers are striking.</p>
      )}
    </Card>
  );
}

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="This system isn't developed yet — no established population." />
    );
  }

  const { population, popCap, unrest, striking, needs, provision, unrestBreakdown } = pop;

  // A genuinely uninhabited system (no residents, no standing unrest) stays on the empty state.
  // A popCap <= 0 system that still has residents or unrest — collapsed housing stranding a
  // population — must render Population/Stability/Provisioned like any other system; see §6.
  if (populationPanelView({ population, popCap, unrest }) === "uninhabited") {
    return (
      <EmptyState message="Uninhabited — no population is established here. This system's deposits are charted on the Astrography tab." />
    );
  }

  return (
    <div className="space-y-6">
      <Card variant="bordered" padding="md">
        <PopulationSummary population={population} popCap={popCap} />
      </Card>

      <StabilityBlock unrest={unrest} striking={striking} unrestBreakdown={unrestBreakdown} />

      <ProvisionBlock read={provision} needs={needs} />
    </div>
  );
}
