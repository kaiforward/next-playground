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
 * The headline is **stability**, `1 - unrest` — the same quantity the faction page
 * (`vitals.stabilityPct`) and the map's stability mode already render, so this block stops being
 * the one surface in the app that prints unrest under a "Stability" heading. It is derived from
 * `unrest` — the same actual, current-tick value the badge label and `striking` are computed
 * from — never `unrestBreakdown.settled` (the contributors' capped sum, which is only where
 * unrest is *heading*; the accumulator lags behind it during a transient, so a headline built on
 * it could print a calm figure beside a striking badge).
 *
 * The contributor bars stay on the raw unrest scale on purpose: a bar's value already reads as
 * "how many stability points this cause is costing" (costing 30 points of stability IS
 * contributing 0.3 of unrest — same quantity, no separate inversion to get wrong), so they now
 * move the same way the eye reads "worse" as the headline does — bars grow, headline shrinks —
 * instead of the previous version where an unrest headline grew right alongside them.
 *
 * **No per-bar strike marker.** The three causes sum (`settled = min(1, goods + tax + crowding)`,
 * `lib/services/system-population.ts`), so the strike line is a property of the total and of
 * nothing else: a system strikes at goods 0.3 + tax 0.2 + crowding 0.2 with no single cause near
 * the threshold. A tick drawn across each bar reads as a per-cause limit that does not exist, and
 * understates the risk on exactly the systems carrying three moderate pressures at once. The line
 * is carried in the caption, against the headline it actually governs.
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
  // The goods contributor is withheld (not zero) pre-assessment — the segment list below already
  // drops it rather than fabricating a bar. The headline stays honest regardless: it reads live
  // `unrest`, never the visible segments' sum, so an unassessed system's missing goods bar cannot
  // make it print calmer than the world actually is.
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
      <ContributorBreakdown value={1 - unrest} segments={segments} total={1} />
      <p className="mt-2 text-xs text-text-tertiary">
        Strike below {fractionPct(1 - unrestBreakdown.strikeThreshold)}% stability.
      </p>
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
