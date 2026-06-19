import type { TxClient } from "@/lib/tick/types";
import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { demandRateForGood } from "@/lib/constants/market-economy";

/**
 * Live-game adapter for the population processor. Bulk writes via unnest() — no
 * per-row writes inside the transaction. demandRate is recomputed adapter-side
 * (it owns the system→market→good join) from each system's new population.
 */
export class PrismaPopulationWorld implements PopulationWorld {
  constructor(private tx: TxClient) {}

  async getPopulationState(systemIds: string[]): Promise<PopulationStateView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, population: true, popCap: true, unrest: true },
    });
    return rows.map((r) => ({ systemId: r.id, population: r.population, popCap: r.popCap, unrest: r.unrest }));
  }

  async applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map((u) => u.systemId);
    const pops = updates.map((u) => (isFinite(u.population) ? Math.max(0, u.population) : 0));
    const unrests = updates.map((u) => (isFinite(u.unrest) ? Math.max(0, Math.min(1, u.unrest)) : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "population" = batch."population", "unrest" = batch."unrest"
      FROM unnest(${ids}::text[], ${pops}::double precision[], ${unrests}::double precision[])
        AS batch("id", "population", "unrest")
      WHERE ss."id" = batch."id"`;
  }

  async rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void> {
    if (pops.length === 0) return;
    const popBySystem = new Map(pops.map((p) => [p.systemId, p.population]));
    const markets = await this.tx.stationMarket.findMany({
      where: { station: { systemId: { in: [...popBySystem.keys()] } } },
      select: { id: true, good: { select: { name: true } }, station: { select: { systemId: true } } },
    });
    const ids: string[] = [];
    const rates: number[] = [];
    for (const m of markets) {
      const population = popBySystem.get(m.station.systemId);
      if (population == null) continue;
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const rate = demandRateForGood(goodKey, population);
      ids.push(m.id);
      rates.push(isFinite(rate) ? rate : 1);
    }
    if (ids.length === 0) return;
    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "demandRate" = batch."rate"
      FROM unnest(${ids}::text[], ${rates}::double precision[])
        AS batch("id", "rate")
      WHERE sm."id" = batch."id"`;
  }
}
