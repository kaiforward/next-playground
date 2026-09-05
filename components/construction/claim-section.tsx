"use client";

import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useClaimSystem } from "@/lib/hooks/use-claims";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLinkComponent } from "@/components/ui/link-provider";
import { formatDuration } from "@/lib/utils/calendar";
import { LANES } from "@/lib/constants/lanes";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { ClaimAdjacentSystem } from "@/lib/types/api";

/** "Kerrin" for one owned neighbour, "Kerrin, Marrow" for several — the claim quote's own list
 *  style, never an oxford "and" (the prototype's own wording: "Borders <A>[, <B>], which you hold"). */
function joinNames(systems: ClaimAdjacentSystem[]): string {
  return systems.map((s) => s.systemName).join(", ");
}

/**
 * The claim verb's entry on the system Overview — the `ColonySection` counterpart for an
 * UNCLAIMED system bordering the player's territory (`ColonySection` is gated on `controlled`, so
 * nothing else on the Overview covers this state). Renders nothing unless
 * `useSystemBuildOptions` reports `mode: "claim"` — a foreign or non-adjacent-unclaimed system
 * carries `mode: "none"` and this section stays absent, same as `ColonySection` on a foreign world.
 */
export function ClaimSection({ systemId, systemName }: { systemId: string; systemName: string }) {
  const buildSurface = useSystemBuildOptions(systemId);
  const claimSystem = useClaimSystem(systemId);
  const LinkComponent = useLinkComponent();

  if (buildSurface.mode !== "claim") return null;
  const { claim } = buildSurface;
  const names = joinNames(claim.adjacentOwned);
  const laneCount = claim.adjacentOwned.length;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title="Territory" />
      <CardContent>
        <p className="mb-3 text-sm text-text-tertiary">
          Unclaimed. Borders <span className="text-text-accent">{names}</span>, which you hold.
        </p>
        <Button
          variant="action"
          color="green"
          size="sm"
          disabled={claim.state === "cooldown" || claimSystem.isPending}
          onClick={() => claimSystem.mutate()}
        >
          ◆ Claim system
        </Button>
        {claim.state === "eligible" ? (
          <p className="mt-2.5 text-xs text-text-secondary">
            free · brings the{" "}
            {claim.adjacentOwned.map((a, i) => (
              <span key={a.systemId}>
                {i > 0 && ", "}
                <LinkComponent href={`/system/${a.systemId}`} className="font-mono text-text-primary">
                  {a.systemName} — {systemName}
                </LinkComponent>
              </span>
            ))}{" "}
            lane{laneCount === 1 ? "" : "s"} under your control · next claim in{" "}
            {formatDuration(LANES.PLAYER_CLAIM_COOLDOWN * CYCLE_LENGTH)}
          </p>
        ) : (
          <p className="mt-2.5 text-xs text-status-amber-light">
            Your surveyors are still registering the last claim — ready in{" "}
            {formatDuration(claim.remainingTicks)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
