import type { TxClient, PlayerEventMap } from "@/lib/tick/types";
import type {
  AcceptedMissionView,
  ActiveEventView,
  MarketPriceView,
  MissionCreate,
  TradeMissionsWorld,
} from "@/lib/tick/world/trade-missions-world";
import { calculatePrice } from "@/lib/engine/pricing";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { persistPlayerNotifications } from "@/lib/tick/helpers";
import { toEventTypeId } from "@/lib/types/guards";

/** Live-game adapter for the trade-missions processor. */
export class PrismaTradeMissionsWorld implements TradeMissionsWorld {
  constructor(private tx: TxClient) {}

  async expireUnclaimedMissions(currentTick: number): Promise<number> {
    const result = await this.tx.tradeMission.deleteMany({
      where: { deadlineTick: { lte: currentTick }, playerId: null },
    });
    return result.count;
  }

  async getExpiredAcceptedMissions(
    currentTick: number,
  ): Promise<AcceptedMissionView[]> {
    const rows = await this.tx.tradeMission.findMany({
      where: { deadlineTick: { lte: currentTick }, playerId: { not: null } },
      select: {
        id: true,
        playerId: true,
        quantity: true,
        destinationId: true,
        good: { select: { name: true } },
        destination: { select: { name: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      playerId: m.playerId!,
      quantity: m.quantity,
      destinationId: m.destinationId,
      goodName: m.good.name,
      destinationName: m.destination.name,
    }));
  }

  async deleteMissions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.tradeMission.deleteMany({ where: { id: { in: ids } } });
  }

  async getMarketPrices(): Promise<MarketPriceView[]> {
    const rows = await this.tx.stationMarket.findMany({
      include: {
        good: true,
        station: { select: { systemId: true } },
      },
    });
    return rows.map((m) => ({
      systemId: m.station.systemId,
      goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.id,
      currentPrice: calculatePrice(
        m.good.basePrice,
        m.supply,
        m.demand,
        m.good.priceFloor,
        m.good.priceCeiling,
      ),
      basePrice: m.good.basePrice,
    }));
  }

  async getActiveEvents(): Promise<ActiveEventView[]> {
    const rows = await this.tx.gameEvent.findMany({
      where: { systemId: { not: null } },
      select: { id: true, type: true, systemId: true },
    });
    return rows
      .filter((e): e is typeof e & { systemId: string } => e.systemId !== null)
      .map((e) => ({
        id: e.id,
        type: toEventTypeId(e.type),
        systemId: e.systemId,
      }));
  }

  async getAvailableMissionCountsByStation(): Promise<Map<string, number>> {
    const rows = await this.tx.tradeMission.groupBy({
      by: ["systemId"],
      where: { playerId: null },
      _count: { id: true },
    });
    return new Map(rows.map((r) => [r.systemId, r._count.id]));
  }

  async resolveGoodIds(): Promise<Map<string, string>> {
    const rows = await this.tx.good.findMany({ select: { id: true, name: true } });
    const map = new Map<string, string>();
    for (const g of rows) {
      const key = GOOD_NAME_TO_KEY.get(g.name);
      if (key) map.set(key, g.id);
      // Also map by lowercase name for direct-name lookups.
      map.set(g.name.toLowerCase(), g.id);
    }
    return map;
  }

  async createMissions(rows: MissionCreate[]): Promise<void> {
    if (rows.length === 0) return;
    await this.tx.tradeMission.createMany({ data: rows });
  }

  async persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void> {
    await persistPlayerNotifications(this.tx, events, tick);
  }
}
