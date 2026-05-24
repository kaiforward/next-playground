import type { TxClient } from "@/lib/tick/types";
import type {
  MarketView,
  PriceHistoryView,
  SnapshotsWorld,
} from "@/lib/tick/world/snapshots-world";
import type { PriceHistoryEntry } from "@/lib/engine/snapshot";

/**
 * Live-game adapter for the price-snapshots processor.
 *
 * Internally maps systemId → PriceHistory row id (the schema's PK) so the
 * processor body can stay in the systemId domain. The bulk-update via
 * `unnest()` stays here, not in the processor body.
 */
export class PrismaSnapshotsWorld implements SnapshotsWorld {
  private idBySystem = new Map<string, string>();

  constructor(private tx: TxClient) {}

  async getMarkets(): Promise<MarketView[]> {
    const rows = await this.tx.stationMarket.findMany({
      select: {
        goodId: true,
        supply: true,
        demand: true,
        good: {
          select: { basePrice: true, priceFloor: true, priceCeiling: true },
        },
        station: { select: { system: { select: { id: true } } } },
      },
    });

    return rows.map((r) => ({
      systemId: r.station.system.id,
      goodId: r.goodId,
      supply: r.supply,
      demand: r.demand,
      basePrice: r.good.basePrice,
      priceFloor: r.good.priceFloor,
      priceCeiling: r.good.priceCeiling,
    }));
  }

  async getPriceHistories(): Promise<PriceHistoryView[]> {
    const rows = await this.tx.priceHistory.findMany({
      select: { id: true, systemId: true, entries: true },
    });

    this.idBySystem.clear();
    return rows.map((r) => {
      this.idBySystem.set(r.systemId, r.id);
      const entries: PriceHistoryEntry[] = JSON.parse(r.entries);
      return { systemId: r.systemId, entries };
    });
  }

  async writePriceHistories(views: PriceHistoryView[]): Promise<void> {
    if (views.length === 0) return;

    const ids: string[] = [];
    const serialized: string[] = [];
    for (const v of views) {
      const id = this.idBySystem.get(v.systemId);
      if (!id) continue;
      ids.push(id);
      serialized.push(JSON.stringify(v.entries));
    }

    if (ids.length === 0) return;

    await this.tx.$executeRaw`
      UPDATE "PriceHistory" AS ph
      SET "entries" = batch."entries"
      FROM unnest(${ids}::text[], ${serialized}::text[])
        AS batch("id", "entries")
      WHERE ph."id" = batch."id"`;
  }
}
