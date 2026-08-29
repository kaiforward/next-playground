"use client";

import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useOrderColony, useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConstructionRow } from "@/components/construction/construction-row";
import { formatCredits, formatMagnitude } from "@/lib/utils/format";
import { COLONY_BLOCK_COPY } from "@/lib/types/colonisation";
import type { ColonyPreviewData } from "@/lib/types/api";

/** The founding quote: seed sizing, then money. Rendered whenever a quote exists — under the live
 *  Establish verb, and under a money-blocked one so the player can see what it would take. */
function ColonyPreviewLines({ preview }: { preview: ColonyPreviewData }) {
  return (
    <>
      <p className="mt-2.5 text-xs text-text-secondary">
        seeds <span className="font-mono text-text-primary">{formatMagnitude(preview.seedPop)}</span> pop
        from <span className="text-text-accent">{preview.sourceSystemName}</span> ·{" "}
        <span className="font-mono text-text-primary">{preview.housingLevels}</span> housing bundled ·{" "}
        <span className="font-mono text-text-primary">{formatMagnitude(preview.work)}</span> work
      </p>
      {/* "up to" on the materials: the projection is the uncapped want, an upper bound on what
          the founder will actually be asked to spare. */}
      <p className="mt-1 text-xs text-text-secondary">
        charter{" "}
        <span className="font-mono text-text-primary">{formatCredits(Math.round(preview.charter))}</span>{" "}
        · up to{" "}
        <span className="font-mono text-text-primary">{formatCredits(Math.round(preview.projectedBill))}</span>{" "}
        of materials
      </p>
      {/* The gate's whole threshold, from the same function the order boundary checks — the charter
          is spent at the click, the rest must merely be free as a buffer for the materials. */}
      <p className="mt-1 text-xs text-text-secondary">
        requires{" "}
        <span className="font-mono text-text-primary">{formatCredits(Math.round(preview.commitment))}</span>{" "}
        available to commit
      </p>
    </>
  );
}

/**
 * A controlled system's founding entry, rendered on the system Overview for a not-yet-developed
 * system. Forming → the colony project hero-sized (cancellable when player-ordered); eligible →
 * the Establish verb + its preview (the preview line IS the confirmation surface — the click
 * orders directly); ineligible → the verb disabled with the planner's blocking reason. Foreign
 * systems render forming read-only.
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
              Controlled, not yet colonised. Charted resources await development.
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
            <ColonyPreviewLines preview={colony.preview} />
          </>
        ) : colony ? (
          <>
            <p className="mb-3 text-sm text-text-tertiary">Controlled, not yet colonised.</p>
            <Button variant="action" color="green" size="sm" disabled>◆ Establish colony</Button>
            {colony.preview !== null && <ColonyPreviewLines preview={colony.preview} />}
            <p className="mt-2.5 text-xs text-status-amber-light">{COLONY_BLOCK_COPY[colony.reason]}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
