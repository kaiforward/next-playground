import type { TxClient } from "@/lib/tick/types";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

/**
 * Cached open-edge list: unique unordered edges whose endpoints share a faction
 * (null===null lets adjacent independents trade). Cross-faction edges excluded.
 * The connection graph + faction assignments are static after seed, so build
 * once per process. Each edge carries fuelCost for distance attenuation.
 * Sorted by "${a}|${b}" so the work-budget cursor is deterministic.
 *
 * The adjacency service is imported dynamically so the unit tests (memory
 * adapter only) don't transitively load lib/prisma.ts and trip its guard.
 */
let cachedOpenEdges: EdgeView[] | null = null;

async function getOpenEdgesCached(tx: TxClient): Promise<EdgeView[]> {
  if (cachedOpenEdges) return cachedOpenEdges;

  const { getSystemFactionMap } = await import("@/lib/services/adjacency");
  const sysFaction = await getSystemFactionMap();

  const conns = await tx.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });

  cachedOpenEdges = buildOpenEdges(conns, sysFaction);
  return cachedOpenEdges;
}

export class PrismaTradeFlowWorld implements TradeFlowWorld {
  constructor(private tx: TxClient) {}

  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdgesCached(this.tx);
  }

  async getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.stationMarket.findMany({
      where: { station: { systemId: { in: systemIds } } },
      include: { good: true, station: { select: { systemId: true } } },
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

  async getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (systemIds.length === 0) return result;
    const cutoff = new Date(Date.now() - TRADE_SIMULATION.PLAYER_VOLUME_WINDOW_MS);
    const rows = await this.tx.tradeHistory.findMany({
      where: { createdAt: { gt: cutoff }, station: { systemId: { in: systemIds } } },
      select: { quantity: true, station: { select: { systemId: true } } },
    });
    for (const r of rows) {
      const sid = r.station.systemId;
      result.set(sid, (result.get(sid) ?? 0) + r.quantity);
    }
    return result;
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

  async applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void> {
    if (increments.length === 0) return;
    const ids = increments.map((i) => i.systemId);
    const amounts = increments.map((i) => (isFinite(i.amount) ? Math.round(i.amount) : 0));
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
    await this.tx.tradeFlow.deleteMany({ where: { tick: { lt: beforeTick } } });
  }
}
