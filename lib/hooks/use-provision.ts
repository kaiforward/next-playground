"use client";

import { useSystemValueMap } from "./use-system-value-map";
import type { ProvisionEntry } from "@/lib/types/game";

const pickProvision = (e: ProvisionEntry) => e.provision;

/**
 * All-systems Provisioned (0…1 fraction), keyed by systemId — assessed systems only (an unassessed
 * system carries no entry; the store's `provision` slice gates it out, mirroring `useMigration`'s
 * developed-only gate). See `useSystemValueMap` for the reduction/gating contract.
 *
 * Unlike the other value-mode hooks, this raw fraction is never scoped to a faction max on the way to
 * the ramp — provision's band edges are absolute percentages (see `value-ramp.ts`), so the ramp
 * ignores `referenceMax` entirely and this hook carries the plain reading.
 */
export function useProvision(active: boolean = true): Map<string, number> {
  return useSystemValueMap((state) => state.slices.provision, pickProvision, active);
}
