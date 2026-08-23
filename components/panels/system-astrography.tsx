"use client";

import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { StarGlyph } from "@/components/system/star-glyph";
import { BodyCard } from "@/components/system/body-card";
import { SUN_CLASSES } from "@/lib/constants/bodies";

/** Moved from `app/(game)/@panel/system/[systemId]/astrography/page.tsx`. */
export function SystemAstrography({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, peopleLand, bodies } = substrate;

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
              reading died with `availableSpace`; a zero-people-land system reads a bare "0", not a
              share of anything). */}
          <StatRow label="People land">
            <span className="font-mono text-sm text-text-primary">{peopleLand.toFixed(0)}</span>
          </StatRow>
        </StatList>
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
