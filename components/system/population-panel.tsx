"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { ContributorBars } from "@/components/ui/contributor-bars";
import { TrackMarker } from "@/components/ui/track-marker";
import { PopulationSummary } from "@/components/system/population-summary";
import { ProvisionBlock } from "@/components/system/provision-block";
import {
  stabilityView,
  DIRECTION_GLYPH,
  DIRECTION_TEXT,
  DIRECTION_WORD,
  type StabilityView,
} from "@/components/system/stability-view";
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
 * The Stability track — the fill is stability now, a dashed marker shows where it is heading, and a
 * solid red marker shows the strike line. Same visual vocabulary as the Provisioned track (a level
 * plus markers that say "and here is the other number that matters"), built from the same
 * `TrackMarker`, so the two blocks read as one language rather than two inventions.
 *
 * The heading-to and strike markers can land on the same position — a world whose causes have
 * settled right at the strike line — so they overhang opposite edges: the projected marker sticks
 * up out of the track, the strike marker down. At an identical position they still read as two marks,
 * with dash-vs-solid and grey-vs-red separating them further.
 *
 * Nothing here computes: every number arrives from `stabilityView` already on the stability scale.
 */
function StabilityTrack({ view }: { view: StabilityView }) {
  return (
    <div className="relative my-2 h-2.5 bg-surface-active">
      <span aria-hidden className="block h-full" style={{ width: `${view.pct}%`, background: view.color }} />
      {view.outlook.known && (
        <TrackMarker pct={view.outlook.pct} color="var(--color-text-secondary)" dashed overhang="up" />
      )}
      <TrackMarker pct={view.strikePct} color="var(--color-status-red)" overhang="down" />
    </div>
  );
}

/**
 * Stability — the badge, the headline with which way it is moving, the track carrying now /
 * heading-to / strike, their key, then the contributor bars naming the causes.
 *
 * Every quantity comes from `stabilityView` (`components/system/stability-view.ts`), the single
 * place unrest becomes stability; this component performs no arithmetic of its own. The panel
 * shows **two moments** — the fill is stability now, the dashed marker is where it is heading — and
 * says so in its key, because the whole defect this layout replaces was a headline and a set of
 * bars silently describing different moments as if they were one.
 *
 * **No per-bar strike marker.** The three causes sum (`settled = min(1, goods + tax + crowding)`,
 * `lib/services/system-population.ts`), so the strike line is a property of the total and of
 * nothing else: a system strikes at goods 0.3 + tax 0.2 + crowding 0.2 with no single cause near
 * the threshold. A tick drawn across each bar reads as a per-cause limit that does not exist, and
 * understates the risk on exactly the systems carrying three moderate pressures at once. The line
 * lives on the track, against the total it actually governs.
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
  const view = stabilityView({ unrest, striking, read: unrestBreakdown });

  return (
    <Card variant="bordered" padding="md">
      <div className="mb-3 flex items-center justify-between">
        <SectionHeader as="h4">Stability</SectionHeader>
        <StabilityBadge unrest={unrest} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl text-text-primary">{view.pct}%</span>
        {view.outlook.known && (
          <span className={`text-xs ${DIRECTION_TEXT[view.outlook.direction]}`}>
            <span aria-hidden className="font-mono">{DIRECTION_GLYPH[view.outlook.direction]}</span>{" "}
            {DIRECTION_WORD[view.outlook.direction]}
          </span>
        )}
      </div>

      <StabilityTrack view={view} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2" style={{ background: view.color }} />
          Now {view.pct}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-0.5 border-l-2 border-dashed border-text-secondary" />
          {view.outlook.known ? `Heading for ${view.outlook.pct}%` : "Heading for — not yet assessed"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-0.5 bg-status-red" />
          Strike below {view.strikePct}%
        </span>
      </div>

      <div className="mt-3">
        <ContributorBars contributors={view.causes} total={1} />
      </div>

      {view.causesIncomplete && (
        <p className="mt-2 text-xs text-text-tertiary">
          Goods shortfall is not assessed yet — this system has not completed an economy cycle, so
          these causes are incomplete and the real pressure may be higher.
        </p>
      )}
      {view.striking && (
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
