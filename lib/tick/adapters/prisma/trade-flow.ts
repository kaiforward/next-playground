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
 * Cached `regionId → unique unordered intra-region edges` map. The connection
 * graph and region assignments are static after seed, so we build this once
 * per process and reuse it across every tick. Replaces a per-tick
 * `tx.systemConnection.findMany` call.
 *
 * The adjacency service is imported dynamically so that the unit tests, which
 * only exercise the pure processor body through the in-memory adapter, do not
 * transitively load `lib/prisma.ts` and trip its DATABASE_URL guard.
 */
let cachedEdgesByRegion: Map<string, EdgeView[]> | null = null;

async function getEdgesByRegion(): Promise<Map<string, EdgeView[]>> {
  if (cachedEdgesByRegion) return cachedEdgesByRegion;

  const { getAdjacencyList, getSystemRegionMap } = await import(
    "@/lib/services/adjacency"
  );
  const [adjacency, sysRegion] = await Promise.all([
    getAdjacencyList(),
    getSystemRegionMap(),
  ]);

  const byRegion = new Map<string, EdgeView[]>();
  const seen = new Set<string>();

  for (const [fromId, neighbors] of adjacency) {
    const fromRegion = sysRegion.get(fromId);
    if (!fromRegion) continue;

    for (const toId of neighbors) {
      if (fromId === toId) continue;
      if (sysRegion.get(toId) !== fromRegion) continue;

      const [a, b] = fromId < toId ? [fromId, toId] : [toId, fromId];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let list = byRegion.get(fromRegion);
      if (!list) {
        list = [];
        byRegion.set(fromRegion, list);
      }
      list.push({ aSystemId: a, bSystemId: b });
    }
  }

  cachedEdgesByRegion = byRegion;
  return byRegion;
}

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
    // skipped (cross-region flow is deferred to a later pass).
    // Reads from the process-level cache built once on first call.
    const byRegion = await getEdgesByRegion();
    return byRegion.get(regionId) ?? [];
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
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
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
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
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
