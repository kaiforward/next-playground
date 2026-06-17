"use client";

import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { getDangerInfo } from "@/lib/utils/system";
import { Badge } from "@/components/ui/badge";
import { QueryBoundary } from "@/components/ui/query-boundary";

function DangerBadge({ danger }: { danger: number }) {
  const info = getDangerInfo(danger);
  return <Badge color={info.color}>{info.label}</Badge>;
}

/**
 * Adds the system's body danger (Σ archetype danger baselines) to the
 * substrate-independent base danger, so the readout includes the same
 * danger-from-bodies term the navigation pipeline applies.
 */
function SystemDangerBadgeInner({
  systemId,
  baseDanger,
}: {
  systemId: string;
  baseDanger: number;
}) {
  const substrate = useSystemSubstrate(systemId);
  const bodyDanger =
    substrate.visibility === "visible"
      ? substrate.bodies.reduce(
          (sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline,
          0,
        )
      : 0;
  return <DangerBadge danger={baseDanger + bodyDanger} />;
}

/**
 * System danger readout for the overview panel. `baseDanger` is the
 * substrate-independent part (government baseline + feature-trait danger).
 * Body danger is fetched in its own boundary so it never blocks the overview —
 * until the substrate loads (or for unsurveyed systems, or on fetch error) the
 * base danger shows. Event-modifier danger is intentionally excluded: this is a
 * static preview, not the live arrival-pipeline value.
 */
export function SystemDangerBadge({
  systemId,
  baseDanger,
}: {
  systemId: string;
  baseDanger: number;
}) {
  return (
    <QueryBoundary
      loadingFallback={<DangerBadge danger={baseDanger} />}
      errorFallback={() => <DangerBadge danger={baseDanger} />}
    >
      <SystemDangerBadgeInner systemId={systemId} baseDanger={baseDanger} />
    </QueryBoundary>
  );
}
