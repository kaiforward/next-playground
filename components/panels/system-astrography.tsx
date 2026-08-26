"use client";

import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StarGlyph } from "@/components/system/star-glyph";
import { BodyReadout } from "@/components/system/body-readout";
import { SystemRings } from "@/components/system/system-rings";
import { PotentialYieldTable } from "@/components/system/potential-yield-table";
import { Tooltip, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { SUN_CLASSES } from "@/lib/constants/bodies";

/** Moved from `app/(game)/@panel/system/[systemId]/astrography/page.tsx`. */
export function SystemAstrography({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);
  // Same service-resolved reading the Population tab's growth line uses (`growthMultiplier`,
  // `lib/services/system-population.ts`) — reused here, never recomputed, so the two tabs can't
  // disagree about the system's habitability. Omitted (not "N/A", never a fabricated 100%) whenever
  // the population read itself is unknown — a surveyed-but-unassessed system has no habitability
  // story yet.
  const pop = useSystemPopulation(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, peopleLand, bodies, potentialYields } = substrate;
  const habitabilityPct = pop.visibility === "visible" ? Math.round(pop.growthMultiplier * 100) : undefined;

  return (
    <div className="space-y-6">
      {/* Star + system map + potential yield, combined into one block: the sun-class name and the
          three headline figures share a row (the row itself is the card's heading, so no separate
          "System Map" label is needed above the diagram), the ring diagram sits directly under it,
          and a hairline divider separates the potential-yield section when it has anything to show. */}
      <Card variant="bordered" padding="md">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-center gap-3">
            <StarGlyph sunClass={sunClass} />
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {SUN_CLASSES[sunClass].name}
            </h3>
          </div>
          {/* Inline `<dl>` rather than the stacked `StatList`/`StatRow` pair: those lay out a
              full-width row per stat with a dotted leader to a right-aligned value, which has no
              inline form worth extending for a single one-off row. Grouping each label/value pair in
              its own `<div>` inside the `<dl>` keeps the dt/dd association HTML5's `<dl>` content
              model allows ("zero or more groups, each of one or more `<dt>` followed by one or more
              `<dd>`, optionally wrapped"), so a screen reader still reads e.g. "Habitability, 87%"
              rather than a bare "87%". */}
          <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <div className="flex items-baseline gap-1">
              <dt className="font-display text-text-tertiary">Bodies</dt>
              <dd className="font-mono text-text-primary">{bodies.length}</dd>
            </div>
            <span aria-hidden="true" className="text-text-tertiary">
              ·
            </span>
            {/* Absolute habitable surface across all bodies — never a percent (the percent-of-available
                reading died with `availableSpace`; a zero-habitable-land system reads a bare "0", not a
                share of anything). */}
            <div className="flex items-baseline gap-1">
              <dt className="font-display text-text-tertiary">Habitable land</dt>
              <dd className="font-mono text-text-primary">{peopleLand.toFixed(0)}</dd>
            </div>
            {habitabilityPct !== undefined && (
              <>
                <span aria-hidden="true" className="text-text-tertiary">
                  ·
                </span>
                <div className="flex items-baseline gap-1">
                  <dt className="font-display text-text-tertiary">Habitability</dt>
                  <dd className="font-mono text-text-primary">{habitabilityPct}%</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        {/* The system as a place: star centred, one ring per body. Renders nothing for a zero-body
            system rather than adding a second empty state — the card grid's `EmptyState` below
            already says so. */}
        {bodies.length > 0 && (
          <div className="mt-3">
            <SystemRings bodies={bodies} sunClass={sunClass} />
          </div>
        )}

        {/* Potential yield — what this system COULD produce, locked bodies included; never what its
            extractors currently realise (that stays the industry panel's worked-prefix yield). The
            explanatory sentence lives in the header's tooltip rather than as inline prose — "Potential"
            already carries the distinction in the label; the tooltip is the fuller version for anyone
            who hovers. */}
        {potentialYields.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <SectionHeader className="mb-3">
              <Tooltip>
                {/* A button does not inherit text-transform, so the header's own `uppercase`
                    stops at the trigger — restated here to match the labels either side. */}
                <TooltipTriggerLabel className="uppercase">Potential yield</TooltipTriggerLabel>
                <TooltipContent className="w-64 text-xs">
                  What this system could produce if every body here were fully developed — not
                  what it produces today.
                </TooltipContent>
              </Tooltip>
            </SectionHeader>
            <PotentialYieldTable rows={potentialYields} />
          </div>
        )}
      </Card>

      {/* Bodies — one card, one row per body, separated by a hairline divider rather than each
          body carrying its own left accent stripe (that stripe idiom is now reserved for the
          section-level cards above). Occupancy still reads in words via BodyReadout's own
          "Occupied" badge. */}
      <div>
        <SectionHeader className="mb-3">System Bodies · {bodies.length}</SectionHeader>
        {bodies.length === 0 ? (
          <EmptyState message="No charted bodies in this system." />
        ) : (
          <Card variant="bordered" padding="md">
            <div className="divide-y divide-border">
              {bodies.map((b) => (
                <div key={b.id} className="py-3 first:pt-0 last:pb-0">
                  <BodyReadout body={b} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
