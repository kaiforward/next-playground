import { prisma } from "../lib/prisma";

async function main() {
  const world = await prisma.gameWorld.findUnique({ where: { id: "world" } });
  console.log(`Current tick: ${world?.currentTick ?? "N/A"}`);

  const eventCount = await prisma.gameEvent.count();
  console.log(`Active events: ${eventCount}`);

  const systemCount = await prisma.starSystem.count();
  console.log(`Total systems: ${systemCount}`);
  console.log(`Coverage: ${((eventCount / systemCount) * 100).toFixed(1)}%`);

  if (eventCount > 0) {
    const byType = await prisma.gameEvent.groupBy({
      by: ["type"],
      _count: true,
      orderBy: { _count: { type: "desc" } },
    });
    console.log("\nEvents by type:");
    for (const row of byType) {
      console.log(`  ${row.type}: ${row._count}`);
    }
  }

  // Economy type distribution
  const economies = await prisma.starSystem.groupBy({
    by: ["economyType"],
    _count: true,
    orderBy: { _count: { economyType: "desc" } },
  });
  console.log("\nEconomy types:");
  for (const e of economies) console.log(`  ${e.economyType}: ${e._count}`);

  // Recent events
  const recentEvents = await prisma.gameEvent.findMany({
    orderBy: { startTick: "desc" },
    take: 10,
    select: {
      type: true,
      startTick: true,
      phase: true,
      phaseDuration: true,
      phaseStartTick: true,
      system: { select: { name: true } },
    },
  });
  console.log("\nMost recent events (by startTick):");
  for (const e of recentEvents) {
    console.log(
      `  ${e.type} @ ${e.system?.name} — started tick ${e.startTick}, phase "${e.phase}" (dur: ${e.phaseDuration}, phaseStart: ${e.phaseStartTick})`,
    );
  }

  // Check player visibility
  const players = await prisma.player.findMany({
    select: { id: true, user: { select: { email: true } } },
  });
  for (const player of players) {
    const shipCount = await prisma.ship.count({ where: { playerId: player.id } });
    const shipSystems = await prisma.ship.findMany({
      where: { playerId: player.id },
      select: { systemId: true },
      distinct: ["systemId"],
    });
    console.log(
      `\nPlayer ${player.user.email}: ${shipCount} ships at ${shipSystems.length} unique system(s)`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
