import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { ServiceError } from "@/lib/services/errors";
import { resolveProvisionRead } from "@/lib/services/provision-read";
import { STRIKE_PARAMS, UNREST_PARAMS, POPULATION_PARAMS, CROWDING } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { systemPopNeeds } from "@/lib/services/pop-needs";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { isEconomicallyActive } from "@/lib/engine/control";
import { unrestContributors, unrestTrend } from "@/lib/engine/unrest-readout";
import { crowdingPressure, type SupplyState } from "@/lib/engine/population";
import type { SystemPopulationData, SystemProvisionRead, SystemUnrestRead } from "@/lib/types/api";
import type { World, WorldSystem } from "@/lib/world/types";

/**
 * The standing unrest floor's tax component for one system — the owning faction's
 * `TAX_LEVEL_UNREST_PRESSURE` lookup, mirroring the per-system map `lib/world/tick.ts` builds at
 * cycle start. A system with no owning faction (`factionId === null`), or whose faction carries no
 * treasury entry, reads zero — never a substituted default tax level, which would fabricate
 * standing pressure for a system the tick itself never charges it to.
 */
export function resolveTaxPressure(system: WorldSystem, world: World): number {
  if (system.factionId === null) return 0;
  const treasury = world.treasuries.find((t) => t.factionId === system.factionId);
  return treasury ? TAX_LEVEL_UNREST_PRESSURE[treasury.taxLevel] : 0;
}

/**
 * The unrest floor's three-way breakdown plus its trend — `SystemUnrestRead`. Resolved through the
 * exact functions the tick uses (`unrestContributors`, `unrestTrend`,
 * `lib/engine/unrest-readout.ts`) from the same signals `WorldSystem` persists at the point of
 * assessment (`provision`, `supplyBand`, `criticalWeight`), so the panel cannot show causes that do
 * not sum to the effect.
 *
 * `survivalShortfall` is derived from the band being Famine rather than persisted separately —
 * load-bearing and non-obvious, so stated here: `foldSupplyState` (`lib/engine/population.ts`) only
 * ever returns `regime: "famine"` from the survival branch, never from binning Provision, so the
 * two are a strict biconditional and re-deriving one from the other is exact, not an approximation.
 * `criticalWeight` has no such biconditional — two systems banded identically can carry very
 * different critical-good weight (`SupplyState`'s own docstring) — which is why it needed its own
 * persisted field. `emptyBasket` stays unpersisted: `supplyUnrestTerm` never reads it, so there is
 * nothing here for it to feed.
 *
 * A system the economy has not yet assessed returns the unassessed arm, carrying only the standing
 * pressure that is knowable without an assessment (tax from the owning faction's level, crowding
 * from occupancy). It deliberately does NOT reuse the population processor's own "unclassified"
 * defaults: that fallback guards an intra-cycle signal inconsistency its own comment documents as
 * unreachable in real play, whereas this branch fires for every system before its first economy
 * cycle — a routine state. Borrowing those defaults would report `goods: 0` for a world nobody has
 * measured, which reads identically to a genuinely well-fed one. `settled` and `trend` are absent
 * from that arm for the same reason: both need the goods term, and deriving them from tax and
 * crowding alone would call a world calm or worsening on a third of the evidence.
 */
export function resolveUnrestBreakdown(
  system: WorldSystem, world: World, provision: SystemProvisionRead,
): SystemUnrestRead {
  const tax = resolveTaxPressure(system, world);
  const crowding = crowdingPressure(
    system.population, system.popCap, POPULATION_PARAMS.crowdBrakeEnd, CROWDING.PRESSURE_MAX,
  );
  if (!provision.assessed || system.criticalWeight === undefined) {
    return { assessed: false, contributors: { tax, crowding }, strikeThreshold: STRIKE_PARAMS.threshold };
  }
  // Past the guard the assessment is complete: `resolveProvisionRead` only reports assessed when
  // both `provision` and `supplyBand` are set, so no `??` fallback below would be reachable.
  const supply: SupplyState = {
    regime: provision.band,
    survivalShortfall: provision.band === "famine",
    criticalWeight: system.criticalWeight,
    emptyBasket: false, // never read by supplyUnrestTerm; deliberately not persisted either.
  };
  const contributors = unrestContributors({
    grievance: provision.grievance,
    d: 1 - provision.pct / 100,
    supply,
    taxPressure: tax,
    population: system.population,
    popCap: system.popCap,
    crowdBrakeEnd: POPULATION_PARAMS.crowdBrakeEnd,
    unrest: UNREST_PARAMS,
  });
  // The fixed point accumulateUnrest relaxes toward is min(1, floor + term) — the accumulator
  // clamps into [0,1], so the raw sum is not what unrest chases once the terms saturate.
  const settled = Math.min(1, contributors.goods + contributors.tax + contributors.crowding);
  return {
    assessed: true,
    contributors,
    settled,
    trend: unrestTrend(system.unrest, settled),
    strikeThreshold: STRIKE_PARAMS.threshold,
  };
}

/**
 * Dynamic population & social state for one system — population, popCap, unrest, a strike flag,
 * the pressure-sorted needs ledger, the Provisioned/band/memory/grievance read
 * (`SystemProvisionRead`), and the unrest contributor breakdown/trend (`SystemUnrestRead`). Unlike
 * the substrate read, these fields change every economy tick, so the hook
 * (`useSystemPopulation`) is tick-invalidated.
 */
export function getSystemPopulation(systemId: string): SystemPopulationData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};
  const basis = computeSystemLabourSnapshot(buildings, system.population).basis;
  const needs = systemPopNeeds(systemId, basis);
  const provision = resolveProvisionRead(system);

  return {
    visibility: "visible",
    population: system.population,
    popCap: system.popCap,
    unrest: system.unrest,
    striking: system.unrest >= STRIKE_PARAMS.threshold,
    needs,
    provision,
    unrestBreakdown: resolveUnrestBreakdown(system, world, provision),
  };
}
