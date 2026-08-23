"use client";

import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
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
          <div>
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {SUN_CLASSES[sunClass].name}
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary">
              <span className="font-mono text-text-secondary">{bodies.length}</span>{" "}
              {bodies.length === 1 ? "body" : "bodies"} ·{" "}
              <span className="font-mono text-text-secondary">{peopleLand.toFixed(0)}</span>{" "}
              people land
            </p>
          </div>
        </div>
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
