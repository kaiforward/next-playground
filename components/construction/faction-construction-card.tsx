"use client";

import { useFactionConstruction } from "@/lib/hooks/use-faction-construction";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { ConstructionRow } from "@/components/construction/construction-row";
import { formatMagnitude } from "@/lib/utils/format";

/**
 * The faction's construction roll-up: pool header + two locked groups (Expansion on top — the
 * colony-discoverability headline — then Build-out). Lives at the top of the faction detail page.
 */
export function FactionConstructionCard({ factionId }: { factionId: string }) {
  const data = useFactionConstruction(factionId);
  const empty = data.expansion.length === 0 && data.buildOut.length === 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Construction"
        subtitle={`pool ${formatMagnitude(data.pool)}/pulse · ${data.expandCount} forming · ${data.buildCount} building`}
      />
      <CardContent>
        {empty ? (
          <EmptyState message="No active construction or expansion." />
        ) : (
          <>
            <p className="mb-3 font-mono text-[10px] text-text-tertiary">
              ≈ estimates at the current funding rate — the bar (work done) is exact.
            </p>
            {data.expansion.length > 0 && (
              <div className="mb-4">
                <SectionHeader as="h4" className="mb-2">Expansion</SectionHeader>
                {data.expansion.map((row) => <ConstructionRow key={row.id} row={row} showSystem />)}
              </div>
            )}
            {data.buildOut.length > 0 && (
              <div>
                <SectionHeader as="h4" className="mb-2">Build-out</SectionHeader>
                {data.buildOut.map((row) => <ConstructionRow key={row.id} row={row} showSystem />)}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
