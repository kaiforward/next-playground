import type { TxClient } from "@/lib/tick/types";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowWorld,
} from "@/lib/tick/world/trade-flow-world";
import { getOpenEdges as getOpenEdgesShared } from "@/lib/services/topology";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

export class PrismaTradeFlowWorld implements TradeFlowWorld {
  constructor(private tx: TxClient) {}

  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdgesShared();
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
    // Sum quantity per system in PostgreSQL (Station↔System is 1:1) so this
    // returns one row per system rather than one TradeHistory row per trade.
    // SUM over an Int column comes back as bigint — convert with Number().
    const rows = await this.tx.$queryRaw<
      { systemId: string; total: bigint | null }[]
    >`
      SELECT st."systemId" AS "systemId", SUM(th.quantity) AS total
      FROM "TradeHistory" th
      JOIN "Station" st ON th."stationId" = st.id
      WHERE th."createdAt" > ${cutoff}
        AND st."systemId" = ANY(${systemIds}::text[])
      GROUP BY st."systemId"`;
    for (const r of rows) result.set(r.systemId, Number(r.total ?? 0));
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

  async appendFlowEvents(events: FlowEventInsert[]): Promise<void> {
    if (events.length === 0) return;
    await this.tx.tradeFlow.createMany({ data: events });
  }

  async pruneFlowEvents(beforeTick: number): Promise<void> {
    await this.tx.tradeFlow.deleteMany({ where: { tick: { lt: beforeTick } } });
  }
}
