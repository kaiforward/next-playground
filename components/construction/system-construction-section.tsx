"use client";

import Link from "next/link";
import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ConstructionRow } from "@/components/construction/construction-row";

/**
 * The system Overview's Construction section. Hidden on a developed world with nothing building;
 * shown (even empty) on a controlled world — where it's the page's primary live content while a
 * colony forms. Renders nothing when hidden so no empty card appears on the common case.
 */
export function SystemConstructionSection({ systemId }: { systemId: string }) {
  const data = useSystemConstruction(systemId);
  if (data.visibility === "hidden") return null;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title="Construction" />
      <CardContent>
        {data.visibility === "empty" ? (
          <EmptyState message="Controlled, not yet colonised. No colony effort under way here yet." />
        ) : (
          <>
            <p className="mb-3 font-mono text-[10px] text-text-tertiary">
              ≈ estimates at the current funding rate — the bar (work done) is exact.
            </p>
            {data.projects.map((row) => <ConstructionRow key={row.id} row={row} showSystem={false} />)}
          </>
        )}
      </CardContent>
      <Link
        href={`/factions/${data.factionId}`}
        className="mt-3 block text-xs text-text-accent hover:text-text-accent-hover transition-colors"
      >
        see all faction construction →
      </Link>
    </Card>
  );
}
