import "dotenv/config";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { GOODS } from "@/lib/constants/goods";
import { SYSTEMS, CONNECTIONS, ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import type { EconomyType } from "@/lib/types/game";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Clear existing data
  await prisma.tradeHistory.deleteMany();
  await prisma.cargoItem.deleteMany();
  await prisma.stationMarket.deleteMany();
  await prisma.systemConnection.deleteMany();
  await prisma.ship.deleteMany();
  await prisma.player.deleteMany();
  await prisma.station.deleteMany();
  await prisma.good.deleteMany();
  await prisma.starSystem.deleteMany();

  // Seed goods
  const goodRecords: Record<string, { id: string }> = {};
  for (const [key, def] of Object.entries(GOODS)) {
    const good = await prisma.good.create({
      data: { name: def.name, basePrice: def.basePrice, category: def.category },
    });
    goodRecords[key] = good;
  }
  console.log(`  Created ${Object.keys(goodRecords).length} goods`);

  // Seed star systems + stations
  const systemRecords: Record<string, { id: string }> = {};
  for (const [key, def] of Object.entries(SYSTEMS)) {
    const system = await prisma.starSystem.create({
      data: {
        name: def.name,
        economyType: def.economyType,
        x: def.x,
        y: def.y,
        description: def.description,
        station: {
          create: { name: def.stationName },
        },
      },
      include: { station: true },
    });
    systemRecords[key] = system;

    // Create market entries for each good at this station
    const stationId = system.station!.id;
    const produces = ECONOMY_PRODUCTION[def.economyType as EconomyType] ?? [];
    const consumes = ECONOMY_CONSUMPTION[def.economyType as EconomyType] ?? [];

    for (const [goodKey, goodRec] of Object.entries(goodRecords)) {
      const isProduced = produces.includes(goodKey);
      const isConsumed = consumes.includes(goodKey);

      // Producers have high supply/low demand, consumers the opposite
      let supply = 50;
      let demand = 50;
      if (isProduced) {
        supply = 120;
        demand = 30;
      } else if (isConsumed) {
        supply = 30;
        demand = 120;
      }

      await prisma.stationMarket.create({
        data: {
          stationId,
          goodId: goodRec.id,
          supply,
          demand,
        },
      });
    }
  }
  console.log(`  Created ${Object.keys(systemRecords).length} star systems with stations and markets`);

  // Seed connections (bidirectional)
  let connCount = 0;
  for (const [fromKey, toKey, fuelCost] of CONNECTIONS) {
    const fromId = systemRecords[fromKey].id;
    const toId = systemRecords[toKey].id;

    await prisma.systemConnection.create({
      data: { fromSystemId: fromId, toSystemId: toId, fuelCost },
    });
    await prisma.systemConnection.create({
      data: { fromSystemId: toId, toSystemId: fromId, fuelCost },
    });
    connCount += 2;
  }
  console.log(`  Created ${connCount} connections`);

  console.log("Seeding complete!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
