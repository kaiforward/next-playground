import "dotenv/config";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { GOODS } from "@/lib/constants/goods";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import { EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import {
  UNIVERSE_GEN,
  REGION_IDENTITIES,
  REGION_NAME_PREFIXES,
  ECONOMY_TYPE_WEIGHTS,
} from "@/lib/constants/universe-gen";
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import type { EconomyType } from "@/lib/types/game";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ── Generate universe ──
  const params: GenParams = {
    seed: UNIVERSE_GEN.SEED,
    regionCount: UNIVERSE_GEN.REGION_COUNT,
    systemsPerRegion: UNIVERSE_GEN.SYSTEMS_PER_REGION,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    systemScatterRadius: UNIVERSE_GEN.SYSTEM_SCATTER_RADIUS,
    systemMinDistance: UNIVERSE_GEN.SYSTEM_MIN_DISTANCE,
    extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
    intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
    maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
  };

  const universe = generateUniverse(
    params,
    REGION_IDENTITIES,
    REGION_NAME_PREFIXES,
    ECONOMY_TYPE_WEIGHTS,
  );

  console.log(
    `  Generated: ${universe.regions.length} regions, ${universe.systems.length} systems, ${universe.connections.length} connections`,
  );

  // ── Clear existing data ──
  await prisma.tradeHistory.deleteMany();
  await prisma.cargoItem.deleteMany();
  await prisma.stationMarket.deleteMany();
  await prisma.systemConnection.deleteMany();
  await prisma.ship.deleteMany();
  await prisma.player.deleteMany();
  await prisma.station.deleteMany();
  await prisma.good.deleteMany();
  await prisma.starSystem.deleteMany();
  await prisma.region.deleteMany();
  await prisma.gameWorld.deleteMany();

  // ── Seed goods ──
  const goodRecords: Record<string, { id: string }> = {};
  for (const [key, def] of Object.entries(GOODS)) {
    const good = await prisma.good.create({
      data: { name: def.name, basePrice: def.basePrice, category: def.category },
    });
    goodRecords[key] = good;
  }
  console.log(`  Created ${Object.keys(goodRecords).length} goods`);

  // ── Seed regions ──
  const regionIds: string[] = [];
  for (const region of universe.regions) {
    const created = await prisma.region.create({
      data: {
        name: region.name,
        identity: region.identity,
        x: region.x,
        y: region.y,
      },
    });
    regionIds.push(created.id);
  }
  console.log(`  Created ${regionIds.length} regions`);

  // ── Seed systems + stations + markets ──
  const systemIds: string[] = new Array(universe.systems.length);

  for (const sys of universe.systems) {
    const regionId = regionIds[sys.regionIndex];
    const stationName = `${sys.name} Station`;

    const created = await prisma.starSystem.create({
      data: {
        name: sys.name,
        economyType: sys.economyType,
        x: sys.x,
        y: sys.y,
        description: sys.description,
        regionId,
        isGateway: sys.isGateway,
        station: {
          create: { name: stationName },
        },
      },
      include: { station: true },
    });
    systemIds[sys.index] = created.id;

    // Create market entries for each good
    const stationId = created.station!.id;
    const produces = ECONOMY_PRODUCTION[sys.economyType as EconomyType] ?? [];
    const consumes = ECONOMY_CONSUMPTION[sys.economyType as EconomyType] ?? [];

    for (const [goodKey, goodRec] of Object.entries(goodRecords)) {
      const isProduced = produces.includes(goodKey);
      const isConsumed = consumes.includes(goodKey);

      const target = isProduced
        ? EQUILIBRIUM_TARGETS.produces
        : isConsumed
          ? EQUILIBRIUM_TARGETS.consumes
          : EQUILIBRIUM_TARGETS.neutral;

      await prisma.stationMarket.create({
        data: {
          stationId,
          goodId: goodRec.id,
          supply: target.supply,
          demand: target.demand,
        },
      });
    }
  }
  console.log(
    `  Created ${universe.systems.length} star systems with stations and markets`,
  );

  // ── Seed connections (already bidirectional from generator) ──
  for (const conn of universe.connections) {
    await prisma.systemConnection.create({
      data: {
        fromSystemId: systemIds[conn.fromSystemIndex],
        toSystemId: systemIds[conn.toSystemIndex],
        fuelCost: conn.fuelCost,
      },
    });
  }
  console.log(`  Created ${universe.connections.length} connections`);

  // ── Seed GameWorld singleton ──
  const startingSystemId = systemIds[universe.startingSystemIndex];
  await prisma.gameWorld.create({
    data: {
      id: "world",
      currentTick: 0,
      tickRate: 5000,
      lastTickAt: new Date(),
      startingSystemId,
    },
  });
  console.log(
    `  Created GameWorld (starting system: ${universe.systems[universe.startingSystemIndex].name})`,
  );

  console.log("Seeding complete!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
