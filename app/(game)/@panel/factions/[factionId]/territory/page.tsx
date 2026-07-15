"use client";

import Link from "next/link";
import { use } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { useFaction } from "@/lib/hooks/use-faction";

function FactionTerritoryContent({ factionId }: { factionId: string }) {
  const { faction } = useFaction(factionId);

  return (
    <>
      <Card variant="bordered" padding="md">
        <CardHeader
          title="Territory"
          subtitle={`${faction.territorySize} system${faction.territorySize !== 1 ? "s" : ""}, gateways first.`}
        />
        <CardContent>
          {faction.territory.length === 0 ? (
            <EmptyState message="This faction has no territory." />
          ) : (
            <ul className="space-y-1">
              {faction.territory.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/system/${s.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 bg-surface-hover/40 hover:bg-surface-hover transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-display text-sm text-text-primary truncate">
                        {s.name}
                      </span>
                      {s.isGateway && <Badge color="amber">Gateway</Badge>}
                    </span>
                    <span className="shrink-0 text-xs text-text-tertiary capitalize">
                      {s.economyType}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <SectionHeader as="h3">Political Map</SectionHeader>
        <p className="text-sm text-text-tertiary">
          Toggle the political overlay on the map to see {faction.name} territory at a glance.
        </p>
      </div>
    </>
  );
}

export default function FactionTerritoryPage({
  params,
}: {
  params: Promise<{ factionId: string }>;
}) {
  const { factionId } = use(params);
  return (
    <QueryBoundary>
      <FactionTerritoryContent factionId={factionId} />
    </QueryBoundary>
  );
}
