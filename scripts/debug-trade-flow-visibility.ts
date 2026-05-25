/**
 * Cross-checks trade-flow rows against player visibility. Helps diagnose
 * "the table has data but the API returns []" — almost always a visibility
 * coverage problem.
 *
 * Run with the same env-loading wrapper as debug-trade-flow.ts.
 */
import { prisma } from "@/lib/prisma";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { getPlayerVisibility } from "@/lib/services/visibility-cache";

async function main() {
  const players = await prisma.player.findMany({
    select: { id: true, user: { select: { email: true } } },
  });
  if (players.length === 0) {
    console.log("No players in DB.");
    return;
  }

  const world = await prisma.gameWorld.findUnique({
    where: { id: "world" },
    select: { currentTick: true },
  });
  const currentTick = world?.currentTick ?? 0;
  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  for (const player of players) {
    console.log(`\n── Player ${player.user?.email ?? "?"} (${player.id}) ──`);

    const ships = await prisma.ship.findMany({
      where: { playerId: player.id },
      select: { systemId: true, shipType: true, status: true },
    });
    console.log(`Ships: ${ships.length}`);
    for (const s of ships.slice(0, 5)) {
      console.log(`  ${s.shipType} @ ${s.systemId} (${s.status})`);
    }

    const { visibleSet } = await getPlayerVisibility(player.id);
    console.log(`Visible system count: ${visibleSet.size}`);

    if (visibleSet.size === 0) {
      console.log("⚠ Player has no visibility — overlay would be empty.");
      continue;
    }

    // How many TradeFlow rows touch a visible system?
    const visibleIds = [...visibleSet];
    const flowsAtVisible = await prisma.tradeFlow.count({
      where: {
        tick: { gt: minTick },
        OR: [
          { fromSystemId: { in: visibleIds } },
          { toSystemId: { in: visibleIds } },
        ],
      },
    });
    console.log(`TradeFlow rows touching a visible system (in window): ${flowsAtVisible}`);

    // Group by edge, count how many distinct edges
    const grouped = await prisma.tradeFlow.groupBy({
      by: ["fromSystemId", "toSystemId"],
      where: {
        tick: { gt: minTick },
        OR: [
          { fromSystemId: { in: visibleIds } },
          { toSystemId: { in: visibleIds } },
        ],
      },
      _sum: { quantity: true },
    });

    const edges = new Set<string>();
    let totalVolume = 0;
    for (const row of grouped) {
      const [a, b] =
        row.fromSystemId < row.toSystemId
          ? [row.fromSystemId, row.toSystemId]
          : [row.toSystemId, row.fromSystemId];
      edges.add(`${a}|${b}`);
      totalVolume += row._sum.quantity ?? 0;
    }
    console.log(`Distinct visible-touching edges: ${edges.size}`);
    console.log(`Total volume across those edges: ${totalVolume}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
