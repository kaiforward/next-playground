import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";
import { totalDemandRateForGood } from "@/lib/constants/market-economy";
import { clamp } from "@/lib/utils/math";
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
      out.push({
        systemId: s.id, population: s.population, popCap: s.popCap, unrest: s.unrest,
        provisionExpectation: s.provisionExpectation,
      });
    }
    return Promise.resolve(out);
  }

  /**
   * `provisionExpectation`'s non-finite fallback, deliberately chosen: NOT 0 (0 reads as "resigned
   * to total collapse", a real and false memory, not a neutral default) and NOT dropping the write
   * silently into whatever the merge would do — the row's own prior stored value if one exists,
   * else the key is left absent so a never-seeded system stays never-seeded. `Number.isFinite`
   * treats an absent update value (`undefined`) the same as a corrupt one, so this is also the
   * path the processor's legitimate empty-basket-on-a-never-seeded-system skip takes — the same
   * fallback, not a special case for it. A finite value is clamped into [0, 1] and written as-is.
   * `provision` and `supplyBand` get the same never-write-a-lie guard, but their own (simpler,
   * no-memory) fallback — see the inline comment at the write site below.
   */
  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map(updates.map((u) => [u.systemId, u]));
    this.systems = this.systems.map((s) => {
      const u = bySystem.get(s.id);
      if (!u) return s;
      const next: TickSystem = {
        ...s,
        population: Math.max(0, isFinite(u.population) ? u.population : 0),
        unrest: Math.max(0, Math.min(1, isFinite(u.unrest) ? u.unrest : 0)),
      };
      if (typeof u.provisionExpectation === "number" && Number.isFinite(u.provisionExpectation)) {
        next.provisionExpectation = clamp(u.provisionExpectation, 0, 1);
      } else if (s.provisionExpectation !== undefined) {
        next.provisionExpectation = s.provisionExpectation;
      } else {
        delete next.provisionExpectation;
      }
      // `provision` and `supplyBand` are this cycle's fresh reading, not a memory — unlike
      // `provisionExpectation` just above, a corrupt or missing write drops straight to absent
      // rather than falling back to the prior cycle's stale figure (that fallback is what a
      // MEMORY needs; these two are a snapshot). Mirrors `honestUseRate`'s convention
      // (`rewriteDemandRates` below), not `provisionExpectation`'s.
      if (typeof u.provision === "number" && Number.isFinite(u.provision)) {
        next.provision = clamp(u.provision, 0, 1);
      } else {
        delete next.provision;
      }
      if (u.supplyBand !== undefined) {
        next.supplyBand = u.supplyBand;
      } else {
        delete next.supplyBand;
      }
      return next;
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
