"use client";

import { use } from "react";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StarGlyph } from "@/components/system/star-glyph";
import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";
import { BodyCard } from "@/components/system/body-card";
import { PopulationSummary } from "@/components/system/population-summary";
import { SUN_CLASSES } from "@/lib/constants/bodies";

function AstrographyContent({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);
  const populationState = useSystemPopulation(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, bodies, goods } = substrate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card variant="bordered" padding="md">
        <div className="mb-4 flex items-center gap-3">
          <StarGlyph sunClass={sunClass} />
          <h3 className="font-display text-lg font-semibold text-text-primary">
            {SUN_CLASSES[sunClass].name}
          </h3>
        </div>
        {populationState.visibility === "visible" ? (
          <PopulationSummary
            population={populationState.population}
            popCap={populationState.popCap}
          />
        ) : (
          <EmptyState message="Scan this system with a ship in range to assess its population." />
        )}
      </Card>

      {/* Trade profile — per-good production vs consumption from the substrate */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">
          Trade profile · net production
        </SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What this system&apos;s resources and population produce against what they consume
        </p>
        <SubstrateTradeBars goods={goods} />
      </Card>

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

export default function AstrographyPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <AstrographyContent systemId={systemId} />
    </QueryBoundary>
  );
}
