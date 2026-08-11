import type { GoodSatisfaction } from "@/lib/engine/population";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { consumptionRate, type CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { WorldMarket } from "@/lib/world/types";

/** The part of a system this assembly reads — its civilian demand basis. */
export interface DemandBasisSystem {
  buildings: Record<string, number>;
  population: number;
}

/**
 * Assemble each system's consumed-goods readings from the persisted market rows — the input both
 * harness folds hand to `dissatisfaction`. A good the system does not consume is skipped rather than
 * scored, so a seed colony holding no reactor cores is not read as deprived of them; a market row
 * with no persisted satisfaction reads as fully served, matching the economy cycle's own default.
 *
 * The labour basis is resolved once per system, not once per market row: at ~25 goods a system it is
 * the same snapshot every time, and computing it per row was measurably the more expensive of the two
 * shapes this replaced.
 *
 * `consumptionMult` lets a caller apply active event modifiers to `demanded` the way the economy
 * processor does. Omit it and demand is the unmodified civilian rate.
 */
export function goodSatisfactionsBySystem(
  systems: ReadonlyMap<string, DemandBasisSystem>,
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  consumptionMult?: (systemId: string, goodId: string) => number,
): Map<string, GoodSatisfaction[]> {
  const out = new Map<string, GoodSatisfaction[]>();
  const basisBySystem = new Map<string, CivilianDemandBasis>();
  for (const m of markets) {
    const sys = systems.get(m.systemId);
    if (!sys) continue;
    let basis = basisBySystem.get(m.systemId);
    if (basis === undefined) {
      basis = computeSystemLabourSnapshot(sys.buildings, sys.population).basis;
      basisBySystem.set(m.systemId, basis);
    }
    const mult = consumptionMult ? consumptionMult(m.systemId, m.goodId) : 1;
    const demanded = consumptionRate(m.goodId, basis) * mult;
    if (demanded <= 0) continue;
    const list = out.get(m.systemId) ?? [];
    list.push({ goodId: m.goodId, satisfaction: m.satisfaction ?? 1, demanded });
    out.set(m.systemId, list);
  }
  return out;
}
