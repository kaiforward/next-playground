"use client";

import { ErrorBoundary } from "react-error-boundary";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { dangerBand } from "@/lib/utils/system";
import { Badge } from "@/components/ui/badge";

function DangerBadge({ danger }: { danger: number }) {
  const band = dangerBand(danger);
  return <Badge color={band.color}>{band.label}</Badge>;
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
 * substrate-independent part (government baseline); body danger reads in its own boundary so a
 * read failure (or an unsurveyed system, where `useSystemSubstrate` reports no bodies) never takes
 * the base danger down with it — the badge degrades to base-only rather than disappearing.
 * Event-modifier danger is intentionally excluded: this is a static preview, not the live
 * arrival-pipeline value.
 */
export function SystemDangerBadge({
  systemId,
  baseDanger,
}: {
  systemId: string;
  baseDanger: number;
}) {
  return (
    <ErrorBoundary fallbackRender={() => <DangerBadge danger={baseDanger} />}>
      <SystemDangerBadgeInner systemId={systemId} baseDanger={baseDanger} />
    </ErrorBoundary>
  );
}
