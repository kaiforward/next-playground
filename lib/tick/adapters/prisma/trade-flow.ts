import type { TxClient } from "@/lib/tick/types";
import type {
  EdgeView,
  FlowEventInsert,
  MarketSnapshot,
  MarketUpdate,
  RegionView,
  TradeFlowWorld,
  VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

/**
 * Live-game adapter for the trade-flow processor.
 *
 * Bulk writes via `unnest()` SQL (markets, volume increments) and
 * `createMany` for flow events. Pruning is a single `deleteMany`.
 */
export class PrismaTradeFlowWorld implements TradeFlowWorld {
  constructor(private tx: TxClient) {}

  async getRegions(): Promise<RegionView[]> {
    const rows = await this.tx.region.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async getEdgesForRegion(regionId: string): Promise<EdgeView[]> {
    // Both endpoints must be in the region — gateway/inter-region edges are
    // skipped in PR 1 (the design defers cross-region flow to a later pass).
    const rows = await this.tx.systemConnection.findMany({
      where: {
        fromSystem: { regionId },
        toSystem: { regionId },
      },
      select: { fromSystemId: true, toSystemId: true },
    });

    // Connections are seeded bidirectionally; dedupe to unique unordered pairs.
    const seen = new Set<string>();
    const edges: EdgeView[] = [];
    for (const { fromSystemId, toSystemId } of rows) {
      if (fromSystemId === toSystemId) continue;
      const [a, b] =
        fromSystemId < toSystemId
          ? [fromSystemId, toSystemId]
          : [toSystemId, fromSystemId];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ aSystemId: a, bSystemId: b });
    }
    return edges;
  }

  async getMarketSnapshotsForRegion(
    regionId: string,
  ): Promise<MarketSnapshot[]> {
    const rows = await this.tx.stationMarket.findMany({
      where: { station: { system: { regionId } } },
      include: {
        good: true,
        station: { select: { systemId: true } },
      },
    });

    return rows.map((m) => ({
      id: m.id,
      systemId: m.station.systemId,
      goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
      basePrice: m.good.basePrice,
      supply: m.supply,
      demand: m.demand,
      priceFloor: m.good.priceFloor,
      priceCeiling: m.good.priceCeiling,
    }));
  }

  async getRecentPlayerVolume(regionId: string): Promise<number> {
    const cutoff = new Date(
      Date.now() - TRADE_SIMULATION.PLAYER_VOLUME_WINDOW_MS,
    );
    const agg = await this.tx.tradeHistory.aggregate({
      where: {
        createdAt: { gt: cutoff },
        station: { system: { regionId } },
      },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.id);
    const supplies = updates.map((u) => (isFinite(u.supply) ? u.supply : 0));
    const demands = updates.map((u) => (isFinite(u.demand) ? u.demand : 0));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "supply" = batch."supply", "demand" = batch."demand"
      FROM unnest(${ids}::text[], ${supplies}::double precision[], ${demands}::double precision[])
        AS batch("id", "supply", "demand")
      WHERE sm."id" = batch."id"`;
  }

  async applyVolumeIncrements(
    increments: VolumeIncrement[],
  ): Promise<void> {
    if (increments.length === 0) return;

    const ids = increments.map((i) => i.systemId);
    const amounts = increments.map((i) =>
      isFinite(i.amount) ? Math.round(i.amount) : 0,
    );

    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "tradeVolumeAccum" = ss."tradeVolumeAccum" + batch."amount"
      FROM unnest(${ids}::text[], ${amounts}::integer[])
        AS batch("id", "amount")
      WHERE ss."id" = batch."id"`;
  }

  async appendFlowEvents(events: FlowEventInsert[]): Promise<void> {
    if (events.length === 0) return;
    await this.tx.tradeFlow.createMany({ data: events });
  }

  async pruneFlowEvents(beforeTick: number): Promise<void> {
    await this.tx.tradeFlow.deleteMany({
      where: { tick: { lt: beforeTick } },
    });
  }
}
