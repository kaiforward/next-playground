import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { SNAPSHOT_INTERVAL, MAX_SNAPSHOTS } from "@/lib/constants/snapshot";
import { buildPriceEntry, appendSnapshot } from "@/lib/engine/snapshot";
import { PrismaSnapshotsWorld } from "@/lib/tick/adapters/prisma/snapshots";
import type {
  PriceHistoryView,
  SnapshotsWorld,
} from "@/lib/tick/world/snapshots-world";

/**
 * Pure processor body. Depends only on `SnapshotsWorld`, so it runs unchanged
 * against the Prisma adapter (live game) or the in-memory adapter (unit
 * tests, future sim hooks).
 */
export async function runPriceSnapshotsProcessor(
  world: SnapshotsWorld,
  ctx: TickContext,
): Promise<TickProcessorResult> {
  const markets = await world.getMarkets();
  const histories = await world.getPriceHistories();

  const newEntries = buildPriceEntry(markets, ctx.tick);

  const updates: PriceHistoryView[] = [];
  for (const row of histories) {
    const newEntry = newEntries.get(row.systemId);
    if (!newEntry) continue;
    updates.push({
      systemId: row.systemId,
      entries: appendSnapshot(row.entries, newEntry, MAX_SNAPSHOTS),
    });
  }

  await world.writePriceHistories(updates);

  console.log(
    `[price-snapshots] Tick ${ctx.tick}: snapshotted ${newEntries.size} systems`,
  );

  return {
    globalEvents: {
      priceSnapshot: [{ systemCount: newEntries.size }],
    },
  };
}

export const priceSnapshotsProcessor: TickProcessor = {
  name: "price-snapshots",
  frequency: SNAPSHOT_INTERVAL,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaSnapshotsWorld(ctx.tx);
    return runPriceSnapshotsProcessor(world, ctx);
  },
};
