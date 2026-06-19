import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";
import { demandRateForGood } from "@/lib/constants/market-economy";

/** In-memory adapter for the population processor (sim + unit tests). */
export class InMemoryPopulationWorld implements PopulationWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];

  constructor(initial: { systems: SimSystem[]; markets: SimMarketEntry[] }) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
  }

  getPopulationState(systemIds: string[]): Promise<PopulationStateView[]> {
    const ids = new Set(systemIds);
    const out: PopulationStateView[] = [];
    for (const s of this.systems) {
      if (!ids.has(s.id)) continue;
      out.push({ systemId: s.id, population: s.population, popCap: s.popCap, unrest: s.unrest });
    }
    return Promise.resolve(out);
  }

  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map(updates.map((u) => [u.systemId, u]));
    this.systems = this.systems.map((s) => {
      const u = bySystem.get(s.id);
      if (!u) return s;
      return {
        ...s,
        population: Math.max(0, isFinite(u.population) ? u.population : 0),
        unrest: Math.max(0, Math.min(1, isFinite(u.unrest) ? u.unrest : 0)),
      };
    });
    return Promise.resolve();
  }

  rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void> {
    if (pops.length === 0) return Promise.resolve();
    const popBySystem = new Map(pops.map((p) => [p.systemId, p.population]));
    this.markets = this.markets.map((m) => {
      const population = popBySystem.get(m.systemId);
      if (population == null) return m;
      return { ...m, demandRate: demandRateForGood(m.goodId, population) };
    });
    return Promise.resolve();
  }
}
