"use client";

import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { StarGlyph } from "@/components/system/star-glyph";
import { BodyCard } from "@/components/system/body-card";
import { PotentialYieldTable } from "@/components/system/potential-yield-table";
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
      {/* Star + physical summary */}
      <Card variant="bordered" padding="md">
        <div className="flex items-center gap-3">
          <StarGlyph sunClass={sunClass} />
          <h3 className="font-display text-lg font-semibold text-text-primary">
            {SUN_CLASSES[sunClass].name}
          </h3>
        </div>
        <StatList className="mt-3">
          <StatRow label="Bodies">
            <span className="font-mono text-sm text-text-primary">{bodies.length}</span>
          </StatRow>
          {/* Absolute habitable surface across all bodies — never a percent (the percent-of-available
              reading died with `availableSpace`; a zero-habitable-land system reads a bare "0", not a
              share of anything). */}
          <StatRow label="Habitable land">
            <span className="font-mono text-sm text-text-primary">{peopleLand.toFixed(0)}</span>
          </StatRow>
          {habitabilityPct !== undefined && (
            <StatRow label="Habitability">
              <span className="font-mono text-sm text-text-primary">{habitabilityPct}%</span>
            </StatRow>
          )}
        </StatList>
      </Card>

      {/* Potential yield — what this system COULD produce, locked bodies included; never what its
          extractors currently realise (that stays the industry panel's worked-prefix yield). */}
      {potentialYields.length > 0 && (
        <Card variant="bordered" padding="md">
          <SectionHeader className="mb-1">Potential yield</SectionHeader>
          <p className="mb-3 text-xs text-text-tertiary">
            What this system could produce if every body here were fully developed — not what it
            produces today.
          </p>
          <PotentialYieldTable rows={potentialYields} />
        </Card>
      )}

      {/* Bodies */}
      <div>
        <SectionHeader className="mb-3">System Bodies · {bodies.length}</SectionHeader>
        {bodies.length === 0 ? (
          <EmptyState message="No charted bodies in this system." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {bodies.map((b) => (
              <BodyCard key={b.id} body={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
