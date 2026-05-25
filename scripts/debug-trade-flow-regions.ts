import { prisma } from "@/lib/prisma";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

async function main() {
  const world = await prisma.gameWorld.findUnique({
    where: { id: "world" },
    select: { currentTick: true },
  });
  const currentTick = world?.currentTick ?? 0;
  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // Get all regions
  const regions = await prisma.region.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`Regions: ${regions.length}`);
  regions.forEach((r, i) => console.log(`  ${i.toString().padStart(2)}. ${r.name}  (${r.id})`));

  // Build systemId → regionId map
  const systems = await prisma.starSystem.findMany({
    select: { id: true, regionId: true },
  });
  const sysRegion = new Map(systems.map((s) => [s.id, s.regionId]));
  console.log(`\nTotal systems: ${systems.length}`);

  // Count flow events per region
  const flowRows = await prisma.tradeFlow.findMany({
    where: { tick: { gt: minTick } },
    select: { fromSystemId: true, toSystemId: true, quantity: true },
  });

  const perRegion = new Map<string, { count: number; volume: number }>();
  for (const row of flowRows) {
    const region = sysRegion.get(row.fromSystemId);
    if (!region) continue;
    const stats = perRegion.get(region) ?? { count: 0, volume: 0 };
    stats.count += 1;
    stats.volume += row.quantity;
    perRegion.set(region, stats);
  }

  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  console.log("\nFlow events by region:");
  const ranked = [...perRegion.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [regionId, stats] of ranked) {
    console.log(`  ${(regionName.get(regionId) ?? regionId).padEnd(30)}  ${stats.count.toString().padStart(5)} rows  ${stats.volume.toString().padStart(6)} volume`);
  }

  // Regions with zero flow
  const regionsWithFlow = new Set(perRegion.keys());
  const zeroFlow = regions.filter((r) => !regionsWithFlow.has(r.id));
  if (zeroFlow.length > 0) {
    console.log(`\n⚠ ${zeroFlow.length} region(s) with ZERO flow:`);
    zeroFlow.forEach((r) => console.log(`  ${r.name}  (${r.id})`));
  }

  // Player ship regions vs flow regions
  const playerSystems = await prisma.ship.findMany({
    select: { systemId: true, player: { select: { user: { select: { email: true } } } } },
  });
  console.log("\nPlayer ships' regions:");
  for (const s of playerSystems) {
    const region = sysRegion.get(s.systemId);
    const name = region ? regionName.get(region) : "??";
    const hasFlow = region && regionsWithFlow.has(region);
    console.log(`  ${s.player.user?.email}: system ${s.systemId} → region "${name}" ${hasFlow ? "✓ has flow" : "✗ no flow"}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
