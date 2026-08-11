import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import { readExpectation } from "@/lib/engine/expectation";
import { grievanceShortfall, type SupplyRegime } from "@/lib/engine/population";
import type { SystemProvisionRead } from "@/lib/types/api";
import type { WorldSystem } from "@/lib/world/types";

/**
 * The server-side provision read: everything `SystemProvisionRead` carries to the client, plus
 * `grievance`. Grievance is an input to the unrest floor's goods term
 * (`resolveUnrestBreakdown`, `lib/services/system-population.ts`), not something any panel prints —
 * what the player sees is the effect (the contributor bar), not the intermediate — so it stops at
 * the service boundary and `toProvisionRead` below is what crosses the wire.
 */
export type ResolvedProvision =
  | { assessed: true; pct: number; band: SupplyRegime; expectationPct: number; grievance: number }
  | { assessed: false };

/**
 * Resolves `WorldSystem.provision`/`.supplyBand` into the read, through the exact functions the
 * tick uses (`readExpectation`, `grievanceShortfall`) so this read cannot diverge from the sim.
 *
 * Both persisted fields are independently optional and absent means never assessed — so either one
 * missing, including a partially-written system where only the other is set, renders the unassessed
 * arm rather than fabricating a reading. `band` is carried straight through and never re-derived
 * from `pct`: the survival punch-through puts a starving system at band Famine while its Provisioned
 * still reads high, and re-binning the number would erase exactly that.
 *
 * Shared by both per-system reads (`getSystemPopulation`, `getSystemVitals`), which must agree —
 * two copies of the absent rule would be free to drift, which is the divergence this whole read
 * path exists to prevent.
 */
export function resolveProvisionRead(system: WorldSystem): ResolvedProvision {
  if (system.provision === undefined || system.supplyBand === undefined) return { assessed: false };
  const { effective } = readExpectation(system.provisionExpectation, system.provision, EXPECTATION_PARAMS);
  return {
    assessed: true,
    pct: system.provision * 100,
    band: system.supplyBand,
    expectationPct: effective * 100,
    grievance: grievanceShortfall(effective, system.provision),
  };
}

/**
 * The client-facing projection of a resolved read — field by field, never a spread: the two types
 * differ by one field, so a structural pass-through would keep compiling (and keep serialising
 * `grievance`) the moment either gains another server-only quantity.
 */
export function toProvisionRead(resolved: ResolvedProvision): SystemProvisionRead {
  if (!resolved.assessed) return { assessed: false };
  return {
    assessed: true,
    pct: resolved.pct,
    band: resolved.band,
    expectationPct: resolved.expectationPct,
  };
}
