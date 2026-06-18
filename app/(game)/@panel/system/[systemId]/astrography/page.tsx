"use client";

import { use } from "react";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StarGlyph } from "@/components/system/star-glyph";
import { ResourceVectorBars } from "@/components/system/resource-vector-bars";
import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";
import { BodyCard } from "@/components/system/body-card";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { formatNumber } from "@/lib/utils/format";

function AstrographyContent({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, population, popCap, aggregate, bodies, goods } = substrate;
  const popCapInt = Math.round(popCap);

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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <StatList>
              <StatRow label="Population">
                <span className="font-mono text-sm text-text-primary">
                  {formatNumber(population)}
                </span>
              </StatRow>
              <StatRow label="Capacity">
                <span className="font-mono text-sm text-text-primary">
                  {formatNumber(popCapInt)}
                </span>
              </StatRow>
            </StatList>
            <ProgressBar
              label="Utilisation"
              value={population}
              max={Math.max(1, popCapInt)}
              color="copper"
            />
          </div>
          <div>
            <SectionHeader as="h4" className="mb-1">
              Resource profile · system aggregate
            </SectionHeader>
            <p className="mb-2 text-xs text-text-tertiary">Development potential</p>
            <ResourceVectorBars vector={aggregate} />
          </div>
        </div>
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
