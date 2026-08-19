"use client";

import type { SystemCadence } from "@/lib/types/api";

/**
 * Static per-system cadence for the header countdown — literally `{ resolutionGroup: 0 }` for
 * every system, per the snapshot slice ledger (`lib/runtime/snapshot.ts`'s module docstring): the
 * whole galaxy resolves on one shared cycle boundary, so there is no per-system value to read and
 * no `systemCadence` store slice at all. Kept as a hook (rather than inlining the literal at call
 * sites) so a future per-shard cadence needs no call-site churn. The live countdown is derived
 * client-side from this + the current tick, as before.
 */
const CADENCE: SystemCadence = { resolutionGroup: 0 };

export function useSystemCadence(_systemId: string): SystemCadence | undefined {
  return CADENCE;
}
