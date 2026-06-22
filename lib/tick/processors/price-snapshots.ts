import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { MAX_SNAPSHOTS } from "@/lib/constants/snapshot";
import { buildPriceEntry, appendSnapshot } from "@/lib/engine/snapshot";
import { PrismaSnapshotsWorld } from "@/lib/tick/adapters/prisma/snapshots";
import type {
  PriceHistoryView,
  SnapshotsWorld,
} from "@/lib/tick/world/snapshots-world";

/**
 * Pure processor body. Snapshots the economy's processed shard this tick —
 * reads markets and histories only for the systems the economy just updated.
 * Depends only on `SnapshotsWorld`, so it runs unchanged against the Prisma
 * adapter (live game) or the in-memory adapter (unit tests).
 */
export async function runPriceSnapshotsProcessor(
  world: SnapshotsWorld,
  ctx: TickContext,
): Promise<TickProcessorResult> {
  const signals = ctx.results.get("economy")?.economySignals;
  if (!signals || signals.dissatisfactionBySystem.size === 0) return {};
  const systemIds = [...signals.dissatisfactionBySystem.keys()];

  const markets = await world.getMarketsForSystems(systemIds);
  const histories = await world.getPriceHistoriesForSystems(systemIds);

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
  frequency: 1,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaSnapshotsWorld(ctx.tx);
    return runPriceSnapshotsProcessor(world, ctx);
  },
};
