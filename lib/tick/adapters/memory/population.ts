import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";
import type { ResourceVector } from "@/lib/types/game";
import { totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import type { SystemLabourSnapshot } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";

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
    const buildingsBySystemId = new Map<string, Record<string, number>>();
    const yieldsBySystemId = new Map<string, ResourceVector>();
    for (const s of this.systems) {
      buildingsBySystemId.set(s.id, s.buildings);
      yieldsBySystemId.set(s.id, s.yields);
    }
    // Cache the labour snapshot per system — shared across all of a system's markets
    // (mirrors the prisma adapter); computeSystemLabourSnapshot scans the whole building set.
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
    this.markets = this.markets.map((m) => {
      const population = popBySystem.get(m.systemId);
      if (population == null) return m;
      const buildings = buildingsBySystemId.get(m.systemId) ?? {};
      const yields = yieldsBySystemId.get(m.systemId) ?? unitResourceVector();
      let snap = labourBySystem.get(m.systemId);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(buildings, population);
        labourBySystem.set(m.systemId, snap);
      }
      return { ...m, demandRate: totalDemandRateForGood(m.goodId, snap.basis, buildings, yields, snap.state) };
    });
    return Promise.resolve();
  }
}
