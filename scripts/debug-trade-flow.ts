/**
 * Quick diagnostic for the trade-flow overlay. Run with:
 *   npx tsx scripts/debug-trade-flow.ts
 *
 * Reports total rows, recent activity, top edges by volume, and counts
 * relative to the route-inference floor so we can tell whether the overlay
 * is empty because no flow exists, because totals are below threshold, or
 * because visibility is filtering everything out.
 */
import { prisma } from "@/lib/prisma";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

async function main() {
  const world = await prisma.gameWorld.findUnique({
    where: { id: "world" },
    select: { currentTick: true },
  });
  const currentTick = world?.currentTick ?? 0;
  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  console.log(`Current tick: ${currentTick}`);
  console.log(`Window: tick > ${minTick} (last ${TRADE_SIMULATION.FLOW_HISTORY_TICKS} ticks)`);
  console.log(`Route inference floor: ${TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR}`);
  console.log("---");

  const total = await prisma.tradeFlow.count();
  console.log(`Total TradeFlow rows (all-time):  ${total}`);

  const recent = await prisma.tradeFlow.count({
    where: { tick: { gt: minTick } },
  });
  console.log(`Rows in window:                   ${recent}`);

  if (recent === 0) {
    console.log(
      "\nNo flow rows in window — the processor either hasn't run yet or",
      "isn't producing flow events. Set DEBUG_TRADE_FLOW=1 and watch the",
      "server log to confirm the processor is firing each cycle.",
    );
    return;
  }

  const grouped = await prisma.tradeFlow.groupBy({
    by: ["fromSystemId", "toSystemId", "goodId"],
    where: { tick: { gt: minTick } },
    _sum: { quantity: true },
  });

  // Collapse to undirected edges
  const byEdge = new Map<string, { volume: number; perGood: Map<string, number> }>();
  for (const row of grouped) {
    const qty = row._sum.quantity ?? 0;
    const [a, b] =
      row.fromSystemId < row.toSystemId
        ? [row.fromSystemId, row.toSystemId]
        : [row.toSystemId, row.fromSystemId];
    const key = `${a}|${b}`;
    let entry = byEdge.get(key);
    if (!entry) {
      entry = { volume: 0, perGood: new Map() };
      byEdge.set(key, entry);
    }
    entry.volume += qty;
    entry.perGood.set(row.goodId, (entry.perGood.get(row.goodId) ?? 0) + qty);
  }

  const edgesArr = [...byEdge.entries()].map(([key, v]) => ({
    key,
    volume: v.volume,
    goodCount: v.perGood.size,
  }));
  edgesArr.sort((a, b) => b.volume - a.volume);

  const aboveFloor = edgesArr.filter(
    (e) => e.volume >= TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
  );
  console.log(`Undirected edges with any flow:   ${edgesArr.length}`);
  console.log(`Edges at or above floor (${TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR}):     ${aboveFloor.length}`);

  console.log("\nTop 10 edges by total volume:");
  for (const e of edgesArr.slice(0, 10)) {
    console.log(`  ${e.volume.toString().padStart(6)}   ${e.key}   (${e.goodCount} good${e.goodCount === 1 ? "" : "s"})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
