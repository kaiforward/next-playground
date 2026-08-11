import { getWorld } from "@/lib/world/store";
import type { ProvisionEntry } from "@/lib/types/game";

/**
 * Per-system Provisioned for the Provisioned choropleth — reuses the persisted
 * `StarSystem.provision` (written once per economy cycle), so the map colours the exact number the
 * per-system panel reads, never a re-derived one. The band is not carried: the map's fill steps at
 * the band edges itself, and the band as a signal is the per-system read's business.
 *
 * `supplyBand` is still read, as the other half of the assessment's completeness test: an
 * unassessed system (never run an economy cycle, or a partial write where only one of the two
 * fields landed) is gated out here entirely, mirroring `getMigrationBySystem`'s developed-only
 * gate — rather than the map drawing a hollow reading for it. A half-written assessment is not a
 * real one, and the same pair-completeness rule is what `resolveProvisionRead` applies for the
 * per-system panel. This is deliberately the shape of `migration-map.ts`, not `stability.ts`:
 * stability returns every system unfiltered because a badge consumer also needs the raw unrest for
 * undeveloped systems, but provision (like migration) is a map-only, single-consumer read, so the
 * absence gate belongs in this dedicated service rather than being re-applied by every caller.
 */
export function getProvisionBySystem(): ProvisionEntry[] {
  const entries: ProvisionEntry[] = [];
  for (const s of getWorld().systems) {
    if (s.provision === undefined || s.supplyBand === undefined) continue;
    entries.push({ systemId: s.id, provision: s.provision });
  }
  return entries;
}
