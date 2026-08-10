import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import { readExpectation } from "@/lib/engine/expectation";
import { grievanceShortfall } from "@/lib/engine/population";
import type { SystemProvisionRead } from "@/lib/types/api";
import type { WorldSystem } from "@/lib/world/types";

/**
 * Resolves `WorldSystem.provision`/`.supplyBand` into the client-facing read, through the exact
 * functions the tick uses (`readExpectation`, `grievanceShortfall`) so this read cannot diverge
 * from the sim.
 *
 * Both persisted fields are independently optional and absent means never assessed — so either one
 * missing, including a partially-written system where only the other is set, renders the unassessed
 * arm rather than fabricating a reading. `band` is carried straight through and never re-derived
 * from `pct`: the survival punch-through puts a famine system at band Shortage while its Provisioned
 * still reads high, and re-binning the number would erase exactly that.
 *
 * Shared by both per-system reads (`getSystemPopulation`, `getSystemVitals`), which must agree —
 * two copies of the absent rule would be free to drift, which is the divergence this whole read
 * path exists to prevent.
 */
export function resolveProvisionRead(system: WorldSystem): SystemProvisionRead {
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
