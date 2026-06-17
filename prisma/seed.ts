import "dotenv/config";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { GOODS } from "@/lib/constants/goods";
import { getInitialStock } from "@/lib/constants/market-economy";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
  ACTIVE_SCALE,
} from "@/lib/constants/universe-gen";
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { deriveDominantEconomy } from "@/lib/engine/faction-gen";
import { aggregateColumns, bodyResourceColumns } from "@/lib/engine/resources";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL environment variable is required");
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

const CHUNK_SIZE = 2000;

/** Insert rows in chunks (fire-and-forget) to stay under Postgres's param ceiling. */
async function createManyChunked<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<{ count: number }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await insert(rows.slice(i, i + CHUNK_SIZE));
  }
}

/** Insert rows in chunks, accumulating the returned rows. */
async function createManyAndReturnChunked<T, R>(
  rows: T[],
  insert: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    out.push(...(await insert(rows.slice(i, i + CHUNK_SIZE))));
  }
  return out;
}

async function main() {
  console.log(
    `Seeding database (scale: ${ACTIVE_SCALE}, ${UNIVERSE_GEN.TOTAL_SYSTEMS} systems, ${UNIVERSE_GEN.MAP_SIZE}×${UNIVERSE_GEN.MAP_SIZE} map)...`,
  );

  // ── Generate universe ──
  const params: GenParams = {
    seed: UNIVERSE_GEN.SEED,
    regionCount: UNIVERSE_GEN.REGION_COUNT,
    totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    mapPadding: UNIVERSE_GEN.MAP_PADDING,
    poissonMinDistance: UNIVERSE_GEN.POISSON_MIN_DISTANCE,
    poissonKCandidates: UNIVERSE_GEN.POISSON_K_CANDIDATES,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
    gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
    intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
    maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
    minorFactionCount: UNIVERSE_GEN.MINOR_FACTION_COUNT,
  };

  const universe = generateUniverse(params, REGION_NAMES);

  const majorCount = universe.factions.filter((f) => f.isMajor).length;
  const minorCount = universe.factions.length - majorCount;
  console.log(
    `  Generated: ${universe.regions.length} regions, ${universe.systems.length} systems, ${universe.connections.length} connections, ${majorCount} majors + ${minorCount} minors`,
  );

  // ── Clear existing data (FK-safe order) ──
  await prisma.tradeFlow.deleteMany();
  await prisma.tradeHistory.deleteMany();
  await prisma.battle.deleteMany();
  await prisma.mission.deleteMany();
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
  await prisma.playerNotification.deleteMany();
  await prisma.playerFactionReputation.deleteMany();
  await prisma.player.deleteMany();
  // Clear auth tables so re-registration works after reseed
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.systemTrait.deleteMany();
  await prisma.station.deleteMany();
  await prisma.good.deleteMany();
  await prisma.alliancePact.deleteMany();
  await prisma.factionRelation.deleteMany();
  // StarSystem.factionId → Faction; Faction.homeworldId → StarSystem (cycle).
  // Null systems first so deleting factions doesn't trip the FK.
  await prisma.starSystem.updateMany({ data: { factionId: null } });
  await prisma.faction.deleteMany();
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
        x: region.x,
        y: region.y,
      },
    });
    regionIds.push(created.id);
  }
  console.log(`  Created ${regionIds.length} regions`);

  // ── Seed systems (batched) ──
  // Names are @unique, so we map returned ids back to the generator index by name.
  const createdSystems = await createManyAndReturnChunked(
    universe.systems,
    (batch) =>
      prisma.starSystem.createManyAndReturn({
        data: batch.map((sys) => ({
          name: sys.name,
          economyType: sys.economyType,
          x: sys.x,
          y: sys.y,
          description: sys.description,
          regionId: regionIds[sys.regionIndex],
          isGateway: sys.isGateway,
          sunClass: sys.sunClass,
          population: sys.population,
          popCap: sys.popCap,
          ...aggregateColumns(sys.aggregate),
          bodyDanger: sys.bodyDanger,
        })),
        select: { id: true, name: true },
      }),
  );
  const systemIdByName = new Map(createdSystems.map((s) => [s.name, s.id]));
  const systemIds: string[] = universe.systems.map((s) => {
    const id = systemIdByName.get(s.name);
    if (!id) throw new Error(`System "${s.name}" missing from createManyAndReturn result`);
    return id;
  });

  // ── Seed stations (batched, one per system) ──
  const createdStations = await createManyAndReturnChunked(
    universe.systems,
    (batch) =>
      prisma.station.createManyAndReturn({
        data: batch.map((sys) => ({
          name: `${sys.name} Station`,
          systemId: systemIds[sys.index],
        })),
        select: { id: true, systemId: true },
      }),
  );
  const stationIdBySystemId = new Map(createdStations.map((s) => [s.systemId, s.id]));

  // ── Seed markets (batched, every system × good) ──
  const marketData = universe.systems.flatMap((sys) => {
    const stationId = stationIdBySystemId.get(systemIds[sys.index]);
    if (!stationId) throw new Error(`Station missing for system "${sys.name}"`);
    return Object.entries(goodRecords).map(([goodKey, goodRec]) => ({
      stationId,
      goodId: goodRec.id,
      stock: getInitialStock(sys.economyType, goodKey),
    }));
  });
  await createManyChunked(marketData, (batch) =>
    prisma.stationMarket.createMany({ data: batch }),
  );

  // ── Seed bodies (batched) ──
  const bodyData = universe.systems.flatMap((sys) =>
    sys.bodies.map((b) => ({
      systemId: systemIds[sys.index],
      bodyType: b.bodyType,
      habitable: b.habitable,
      size: b.size,
      ...bodyResourceColumns(b.resourceBase),
      popCapWeight: b.popCapWeight,
      richnessModifiers: b.richnessModifiers,
    })),
  );
  await createManyChunked(bodyData, (batch) =>
    prisma.systemBody.createMany({ data: batch }),
  );

  // ── Seed feature traits (batched) ──
  const traitData = universe.systems.flatMap((sys) =>
    sys.traits.map((t) => ({
      systemId: systemIds[sys.index],
      traitId: t.traitId,
      quality: t.quality,
    })),
  );
  await createManyChunked(traitData, (batch) =>
    prisma.systemTrait.createMany({ data: batch }),
  );

  const totalBodies = bodyData.length;
  const totalTraits = traitData.length;
  console.log(
    `  Created ${universe.systems.length} star systems with stations, markets, ${totalBodies} bodies, and ${totalTraits} feature traits`,
  );

  // ── Compute and store dominant economy per region ──
  // Bulk UPDATE via unnest() — same pattern as the system→faction binding below.
  // Single round-trip handles 600+ regions (10K scale) well under the PG timeout.
  const regionIdsForUpdate: string[] = [];
  const regionDominantEconomies: string[] = [];
  for (let ri = 0; ri < universe.regions.length; ri++) {
    const regionSystems = universe.systems.filter((s) => s.regionIndex === ri);
    regionIdsForUpdate.push(regionIds[ri]);
    regionDominantEconomies.push(deriveDominantEconomy(regionSystems));
  }
  await prisma.$executeRaw`
    UPDATE "Region" AS r
    SET "dominantEconomy" = batch."dominantEconomy"
    FROM unnest(${regionIdsForUpdate}::text[], ${regionDominantEconomies}::text[])
      AS batch("id", "dominantEconomy")
    WHERE r."id" = batch."id"`;
  console.log(`  Updated ${universe.regions.length} regions with dominant economy`);

  // ── Seed factions ──
  // Faction.homeworldId is a unique FK to StarSystem, so systems must already
  // exist. One createManyAndReturn round-trip; map returned ids back to the
  // generator's faction.index by joining on homeworldId (homeworldId is unique
  // per faction, so the lookup is deterministic).
  const factionRows = universe.factions.map((f) => ({
    name: f.name,
    description: f.description,
    governmentType: f.governmentType,
    doctrine: f.doctrine,
    homeworldId: systemIds[f.homeworldSystemIndex],
    color: f.color,
    createdAtTick: 0,
  }));
  const createdFactions = await prisma.faction.createManyAndReturn({
    data: factionRows,
    select: { id: true, homeworldId: true },
  });
  const factionIdByHomeworld = new Map(
    createdFactions.map((f) => [f.homeworldId, f.id]),
  );
  const factionIds: string[] = new Array<string>(universe.factions.length);
  for (const f of universe.factions) {
    const id = factionIdByHomeworld.get(systemIds[f.homeworldSystemIndex]);
    if (!id) {
      throw new Error(`Faction "${f.key}" missing from createManyAndReturn result`);
    }
    factionIds[f.index] = id;
  }
  console.log(`  Created ${factionIds.length} factions (${majorCount} majors + ${minorCount} minors)`);

  // ── Bind each system to its owning faction (bulk UPDATE via unnest) ──
  // Per `MEMORY.md` "Batch all DB writes": at 10k scale the per-row update path
  // hits the 30s PostgreSQL transaction timeout. Single unnest() handles 10K
  // rows in well under a second.
  const sysIdsForUpdate = universe.systems.map((s) => systemIds[s.index]);
  const sysFactionIds = universe.systems.map(
    (s) => factionIds[universe.systemFactionAssignments[s.index]],
  );
  await prisma.$executeRaw`
    UPDATE "StarSystem" AS ss
    SET "factionId" = batch."factionId"
    FROM unnest(${sysIdsForUpdate}::text[], ${sysFactionIds}::text[])
      AS batch("id", "factionId")
    WHERE ss."id" = batch."id"`;
  console.log(`  Bound ${universe.systems.length} systems to owning factions`);

  // ── Seed faction relations ──
  // One row per unordered (factionAId < factionBId) pair, initial score 0.
  // Phase 3's relations processor drifts these from doctrine + government +
  // border + trade-volume drivers — Foundation seeds at neutral so processor
  // tuning has a clean baseline.
  const relationRows: { factionAId: string; factionBId: string }[] = [];
  for (let i = 0; i < factionIds.length; i++) {
    for (let j = i + 1; j < factionIds.length; j++) {
      const a = factionIds[i];
      const b = factionIds[j];
      // Canonical ordering — adapter layer assumes factionAId < factionBId.
      if (a < b) {
        relationRows.push({ factionAId: a, factionBId: b });
      } else {
        relationRows.push({ factionAId: b, factionBId: a });
      }
    }
  }
  await prisma.factionRelation.createMany({
    data: relationRows.map((r) => ({
      factionAId: r.factionAId,
      factionBId: r.factionBId,
      score: 0,
      updatedAtTick: 0,
    })),
  });
  console.log(`  Created ${relationRows.length} faction relation rows`);

  // ── Seed price history (batched, one row per system) ──
  await createManyChunked(
    systemIds.map((systemId) => ({ systemId, entries: "[]" })),
    (batch) => prisma.priceHistory.createMany({ data: batch }),
  );
  console.log(`  Created ${systemIds.length} price history rows`);

  // ── Seed connections (batched; already bidirectional from generator) ──
  await createManyChunked(
    universe.connections.map((conn) => ({
      fromSystemId: systemIds[conn.fromSystemIndex],
      toSystemId: systemIds[conn.toSystemIndex],
      fuelCost: conn.fuelCost,
    })),
    (batch) => prisma.systemConnection.createMany({ data: batch }),
  );
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
