import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";
import { totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import type { SystemLabourSnapshot } from "@/lib/engine/industry";
import { useRatesByGood } from "@/lib/engine/honest-demand";
import type { UseRate } from "@/lib/engine/honest-demand";
import { unitResourceVector } from "@/lib/engine/resources";

/** In-memory adapter for the population processor (harness + unit tests). */
export class InMemoryPopulationWorld implements PopulationWorld {
  systems: TickSystem[];
  markets: WorldMarket[];

  constructor(initial: { systems: TickSystem[]; markets: WorldMarket[] }) {
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

  rewriteDemandRates(
    pops: Array<{ systemId: string; population: number; productionSuppress: number }>,
  ): Promise<void> {
    if (pops.length === 0) return Promise.resolve();
    const rowBySystem = new Map(pops.map((p) => [p.systemId, p]));
    const buildingsBySystemId = new Map<string, Record<string, number>>();
    const yieldsBySystemId = new Map<string, ResourceVector>();
    for (const s of this.systems) {
      buildingsBySystemId.set(s.id, s.buildings);
      yieldsBySystemId.set(s.id, s.yields);
    }
    // Cache the labour snapshot and the whole-system use map per system — both scan the
    // building set once and are shared across all of that system's markets.
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
    const useBySystem = new Map<string, Map<string, UseRate>>();
    this.markets = this.markets.map((m) => {
      const row = rowBySystem.get(m.systemId);
      if (row == null) return m;
      const buildings = buildingsBySystemId.get(m.systemId) ?? {};
      const yields = yieldsBySystemId.get(m.systemId) ?? unitResourceVector();
      let snap = labourBySystem.get(m.systemId);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(buildings, row.population);
        labourBySystem.set(m.systemId, snap);
      }
      let uses = useBySystem.get(m.systemId);
      if (uses === undefined) {
        uses = useRatesByGood({
          buildings,
          population: row.population,
          yields,
          productionSuppress: row.productionSuppress,
        });
        useBySystem.set(m.systemId, uses);
      }
      const honestUseRate = uses.get(m.goodId)?.total ?? 0;
      const next: WorldMarket = {
        ...m,
        // Two figures, two jobs: the floored capacity anchor prices the good, the unfloored
        // use figure sizes its warehousing. Neither is derived from the other.
        demandRate: totalDemandRateForGood(m.goodId, snap.basis, buildings, yields, snap.state),
      };
      // A corrupt compute leaves the field absent — the readers' documented live-recompute path —
      // never 0 (which would make the row un-sinkable and fully drawable at once), and never the
      // stale prior figure the spread above would otherwise keep.
      delete next.honestUseRate;
      if (Number.isFinite(honestUseRate)) next.honestUseRate = Math.max(0, honestUseRate);
      return next;
    });
    return Promise.resolve();
  }
}
