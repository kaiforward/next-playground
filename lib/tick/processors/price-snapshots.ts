import type { TickProcessor, TickProcessorResult } from "../types";
import { SNAPSHOT_INTERVAL, MAX_SNAPSHOTS } from "@/lib/constants/snapshot";
import {
  buildPriceEntry,
  appendSnapshot,
  type PriceHistoryEntry,
} from "@/lib/engine/snapshot";

export const priceSnapshotsProcessor: TickProcessor = {
  name: "price-snapshots",
  frequency: SNAPSHOT_INTERVAL,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    // 1. Fetch all station markets with good basePrice and system id
    const markets = await ctx.tx.stationMarket.findMany({
      select: {
        goodId: true,
        supply: true,
        demand: true,
        good: { select: { basePrice: true, priceFloor: true, priceCeiling: true } },
        station: { select: { system: { select: { id: true } } } },
      },
    });

    // 2. Fetch all existing PriceHistory rows
    const historyRows = await ctx.tx.priceHistory.findMany();

    // 3. Build new entries via pure engine function
    const marketInputs = markets.map((m) => ({
      systemId: m.station.system.id,
      goodId: m.goodId,
      supply: m.supply,
      demand: m.demand,
      basePrice: m.good.basePrice,
      priceFloor: m.good.priceFloor,
      priceCeiling: m.good.priceCeiling,
    }));

    const newEntries = buildPriceEntry(marketInputs, ctx.tick);

    // 4. Append and bulk-write back via single SQL round-trip
    const ids: string[] = [];
    const entriesArr: string[] = [];

    for (const row of historyRows) {
      const newEntry = newEntries.get(row.systemId);
      if (!newEntry) continue;

      const existing: PriceHistoryEntry[] = JSON.parse(row.entries);
      const updated = appendSnapshot(existing, newEntry, MAX_SNAPSHOTS);

      ids.push(row.id);
      entriesArr.push(JSON.stringify(updated));
    }

    if (ids.length > 0) {
      await ctx.tx.$executeRawUnsafe(
        `UPDATE "PriceHistory" AS ph
         SET "entries" = batch."entries"
         FROM (SELECT unnest($1::text[]) AS "id", unnest($2::text[]) AS "entries") AS batch
         WHERE ph."id" = batch."id"`,
        ids,
        entriesArr,
      );
    }

    console.log(
      `[price-snapshots] Tick ${ctx.tick}: snapshotted ${newEntries.size} systems`,
    );

    return {
      globalEvents: {
        priceSnapshot: [{ systemCount: newEntries.size }],
      },
    };
  },
};
