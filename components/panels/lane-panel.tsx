"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The lane panel's route component (`/lane/:key`, Gate C decision: the route option is taken).
 * Minimal for now — a route-docked `DetailPanel` naming both endpoints; Task 13 fills the body
 * (vitals grid, invest/claim verbs, in-transit rows). Selecting a system while this panel is open
 * re-points to the system panel, same as system-to-system today (it's just a navigation).
 *
 * `laneKey` arrives from the URL (a player can type garbage into the address bar), so it's split
 * here without the throwing `laneEndpoints` (`lib/engine/lanes.ts`) — that helper's contract is for
 * keys minted internally by `laneKey()` itself, not untrusted route input.
 */
function splitLaneKey(key: string): [string, string] | null {
  const idx = key.indexOf("|");
  if (idx < 0) return null;
  return [key.slice(0, idx), key.slice(idx + 1)];
}

export function LanePanel({ laneKey }: { laneKey: string }) {
  const endpoints = splitLaneKey(laneKey);
  const { systemInfo: aSystem } = useSystemInfo(endpoints?.[0] ?? "");
  const { systemInfo: bSystem } = useSystemInfo(endpoints?.[1] ?? "");
  // Pre-boot guard: `worldVersion` is null until the worker's first state frame lands, and
  // `useSystemInfo` reads its slice's empty default until then — indistinguishable at this point
  // from a genuinely absent lane. Render nothing rather than flashing not-found for an entity that
  // is really just not loaded yet, same as `SystemPanel`/`FactionPanel`.
  const booted = useGameSlice((state) => state.worldVersion !== null);

  if (!booted) return null;

  if (!endpoints || !aSystem || !bSystem) {
    return (
      <DetailPanel title="Lane">
        <EmptyState message="This lane no longer exists in the current galaxy." />
      </DetailPanel>
    );
  }

  return (
    <DetailPanel title={`${aSystem.name} — ${bSystem.name}`} subtitle="Lane">
      <EmptyState message="Lane detail is coming soon." />
    </DetailPanel>
  );
}
