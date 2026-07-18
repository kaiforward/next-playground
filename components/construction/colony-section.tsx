"use client";

import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useOrderColony, useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConstructionRow } from "@/components/construction/construction-row";
import { formatMagnitude } from "@/lib/utils/format";
import type { ColonyBlockReason } from "@/lib/services/construction-orders";

const REASON_COPY: Record<ColonyBlockReason, string> = {
  already_forming: "A colony is already forming here.",
  below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
  no_seed_source: "No developed system in range to seed a colony from.",
};

/**
 * A controlled system's Industry-tab content — the ledger's founding entry. Forming → the colony
 * project hero-sized (cancellable when player-ordered); eligible → the Establish verb + its preview
 * (the preview line IS the confirmation surface — the click orders directly); ineligible → the
 * verb disabled with the planner's blocking reason. Foreign systems render forming read-only.
 */
export function ColonySection({ systemId }: { systemId: string }) {
  const construction = useSystemConstruction(systemId);
  const buildSurface = useSystemBuildOptions(systemId);
  const orderColony = useOrderColony(systemId);
  const cancel = useCancelOrder();

  const forming = construction.visibility === "visible"
    ? construction.projects.find((p) => p.kind === "colony_establish")
    : undefined;
  const colony = buildSurface.mode === "colony" ? buildSurface.colony : null;
  if (!forming && !colony) return null;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title="Construction" />
      <CardContent>
        {forming ? (
          <ConstructionRow
            row={forming}
            showSystem={false}
            onCancel={buildSurface.mode !== "none" ? (projectId) => cancel.mutate({ projectId }) : undefined}
          />
        ) : colony?.state === "eligible" ? (
          <>
            <p className="mb-3 text-sm text-text-tertiary">
              Controlled, not yet colonised. Charted deposits await development.
            </p>
            <Button
              variant="action"
              color="green"
              size="sm"
              disabled={orderColony.isPending}
              onClick={() => orderColony.mutate()}
            >
              ◆ Establish colony
            </Button>
            <p className="mt-2.5 text-xs text-text-secondary">
              seeds <span className="font-mono text-text-primary">{formatMagnitude(colony.preview.seedPop)}</span> pop
              from <span className="text-text-accent">{colony.preview.sourceSystemName}</span> ·{" "}
              <span className="font-mono text-text-primary">{colony.preview.housingLevels}</span> housing bundled ·{" "}
              <span className="font-mono text-text-primary">{formatMagnitude(colony.preview.work)}</span> work
            </p>
          </>
        ) : colony ? (
          <>
            <p className="mb-3 text-sm text-text-tertiary">Controlled, not yet colonised.</p>
            <Button variant="action" color="green" size="sm" disabled>◆ Establish colony</Button>
            <p className="mt-2.5 text-xs text-status-amber-light">{REASON_COPY[colony.reason]}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
