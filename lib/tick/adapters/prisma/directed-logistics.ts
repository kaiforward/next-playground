import type { TxClient } from "@/lib/tick/types";
import type {
  DirectedLogisticsWorld,
  LogisticsFlowInsert,
  LogisticsMarketUpdate,
  SystemLogisticsRow,
} from "@/lib/tick/world/directed-logistics-world";
import type { Prisma } from "@/app/generated/prisma/client";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { resourceVectorFromColumns } from "@/lib/engine/resources";

export class PrismaDirectedLogisticsWorld implements DirectedLogisticsWorld {
  constructor(private readonly tx: TxClient) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const rows = await this.tx.starSystem.findMany({
      distinct: ["factionId"],
      select: { factionId: true },
    });
    // Stable deterministic order so the shard split is consistent across ticks.
    // null (independents) sorts last.
    return rows
      .map((r) => r.factionId)
      .sort((a, b) =>
        a === null ? 1 : b === null ? -1 : a.localeCompare(b),
      );
  }

  async getSystemsForFactions(
    factionKeys: Array<string | null>,
  ): Promise<SystemLogisticsRow[]> {
    if (factionKeys.length === 0) return [];

    const ids = factionKeys.filter((k): k is string => k !== null);
    const includeNull = factionKeys.some((k) => k === null);

    const where: Prisma.StarSystemWhereInput =
      includeNull && ids.length > 0
        ? { OR: [{ factionId: { in: ids } }, { factionId: null }] }
        : includeNull
          ? { factionId: null }
          : { factionId: { in: ids } };

    // Pull yield* columns and buildings separately to avoid concurrent sub-query
    // issue (CLAUDE.md pg gotcha). relationLoadStrategy: "join" consolidates the
    // station→markets sibling relation into a single LATERAL JOIN.
    const [systems, buildingRows] = await Promise.all([
      this.tx.starSystem.findMany({
        where,
        relationLoadStrategy: "join",
        select: {
          id: true,
          factionId: true,
          population: true,
          yieldGas: true,
          yieldMinerals: true,
          yieldOre: true,
          yieldBiomass: true,
          yieldArable: true,
          yieldWater: true,
          yieldRadioactive: true,
          station: {
            select: {
              markets: {
                select: {
                  id: true,
                  stock: true,
                  anchorMult: true,
                  demandRate: true,
                  storageCapacity: true,
                  good: {
                    select: {
                      name: true,
                      basePrice: true,
                      priceFloor: true,
                      priceCeiling: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.tx.systemBuilding.findMany({
        where: {
          system: where,
        },
        select: { systemId: true, buildingType: true, count: true },
      }),
    ]);

    // Group buildings by system id.
    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }

    return systems.map((s): SystemLogisticsRow => {
      const buildings = buildingsBySystem.get(s.id) ?? {};

      const yields = resourceVectorFromColumns(
        {
          yieldGas: s.yieldGas,
          yieldMinerals: s.yieldMinerals,
          yieldOre: s.yieldOre,
          yieldBiomass: s.yieldBiomass,
          yieldArable: s.yieldArable,
          yieldWater: s.yieldWater,
          yieldRadioactive: s.yieldRadioactive,
        },
        "yield",
      );

      const markets = (s.station?.markets ?? []).map((m) => ({
        // StationMarket has no surrogate goodId key column — derive from the
        // good name using the canonical name→key map (same as trade-flow adapter).
        id: m.id,
        goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
        stock: m.stock,
        basePrice: m.good.basePrice,
        anchorMult: m.anchorMult,
        demandRate: m.demandRate,
        priceFloor: m.good.priceFloor,
        priceCeiling: m.good.priceCeiling,
        storageCapacity: m.storageCapacity,
      }));

      return {
        systemId: s.id,
        factionId: s.factionId,
        population: s.population,
        buildings,
        yields,
        markets,
      };
    });
  }

  async applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    // Clamp non-finite stocks to 0 before raw SQL — NaN/Infinity abort the tx
    // (CLAUDE.md pg gotcha). Row-preserving, matching the trade-flow adapter.
    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (Number.isFinite(u.stock) ? u.stock : 0));
    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
      WHERE sm."id" = batch."id"`;
  }

  async appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    if (flows.length === 0) return;
    await this.tx.tradeFlow.createMany({
      data: flows.map((f) => ({
        tick: f.tick,
        fromSystemId: f.fromSystemId,
        toSystemId: f.toSystemId,
        goodId: f.goodId,
        quantity: f.quantity,
        flowType: "logistics" as const,
      })),
    });
  }
}
