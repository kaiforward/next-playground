import "dotenv/config";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { GOODS } from "@/lib/constants/goods";
import { getProducedGoods, getConsumedGoods } from "@/lib/constants/universe";
import { EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import type { GoodEquilibrium } from "@/lib/constants/goods";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { toEconomyType } from "@/lib/types/guards";
import { SHIP_TYPES } from "@/lib/constants/ships";

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

  const universe = generateUniverse(params, REGION_NAMES);

  console.log(
    `  Generated: ${universe.regions.length} regions, ${universe.systems.length} systems, ${universe.connections.length} connections`,
  );

  // ── Clear existing data (FK-safe order) ──
  await prisma.tradeHistory.deleteMany();
  await prisma.tradeMission.deleteMany();
  await prisma.eventModifier.deleteMany();
  await prisma.gameEvent.deleteMany();
  await prisma.cargoItem.deleteMany();
  await prisma.convoyMember.deleteMany();
  await prisma.shipUpgradeSlot.deleteMany();
  await prisma.stationMarket.deleteMany();
  await prisma.systemConnection.deleteMany();
  await prisma.ship.deleteMany();
  await prisma.convoy.deleteMany();
  await prisma.player.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.systemTrait.deleteMany();
  await prisma.station.deleteMany();
  await prisma.good.deleteMany();
  await prisma.starSystem.deleteMany();
  await prisma.region.deleteMany();
  await prisma.gameWorld.deleteMany();

  // ── Seed goods ──
  const goodRecords: Record<string, { id: string }> = {};
  for (const [key, def] of Object.entries(GOODS)) {
    const good = await prisma.good.create({
      data: {
        name: def.name,
        description: def.description,
        basePrice: def.basePrice,
        tier: def.tier,
        volume: def.volume,
        mass: def.mass,
        volatility: def.volatility,
        hazard: def.hazard,
        priceFloor: def.priceFloor,
        priceCeiling: def.priceCeiling,
      },
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
        governmentType: region.governmentType,
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
        traits: {
          create: sys.traits.map((t) => ({
            traitId: t.traitId,
            quality: t.quality,
          })),
        },
      },
      include: { station: true },
    });
    systemIds[sys.index] = created.id;

    // Create market entries for each good
    const stationId = created.station!.id;
    const econ = toEconomyType(sys.economyType);
    const produces = getProducedGoods(econ);
    const consumes = getConsumedGoods(econ);

    for (const [goodKey, goodRec] of Object.entries(goodRecords)) {
      const isProduced = produces.includes(goodKey);
      const isConsumed = consumes.includes(goodKey);
      const goodEq = GOODS[goodKey]?.equilibrium;

      const target = isProduced
        ? (goodEq?.produces ?? EQUILIBRIUM_TARGETS.produces)
        : isConsumed
          ? (goodEq?.consumes ?? EQUILIBRIUM_TARGETS.consumes)
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
  const totalTraits = universe.systems.reduce((sum, s) => sum + s.traits.length, 0);
  console.log(
    `  Created ${universe.systems.length} star systems with stations, markets, and ${totalTraits} traits`,
  );

  // ── Compute and store dominant economy per region ──
  for (let ri = 0; ri < universe.regions.length; ri++) {
    const regionSystems = universe.systems.filter((s) => s.regionIndex === ri);
    const counts = new Map<string, number>();
    for (const s of regionSystems) {
      counts.set(s.economyType, (counts.get(s.economyType) ?? 0) + 1);
    }
    let dominant = "extraction";
    let best = 0;
    for (const [econ, count] of counts) {
      if (count > best) {
        dominant = econ;
        best = count;
      }
    }
    await prisma.region.update({
      where: { id: regionIds[ri] },
      data: { dominantEconomy: dominant },
    });
  }
  console.log(`  Updated ${universe.regions.length} regions with dominant economy`);

  // ── Seed price history (one row per system) ──
  for (const sysId of systemIds) {
    await prisma.priceHistory.create({
      data: { systemId: sysId, entries: "[]" },
    });
  }
  console.log(`  Created ${systemIds.length} price history rows`);

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
