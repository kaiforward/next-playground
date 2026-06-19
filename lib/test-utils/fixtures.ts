/**
 * Minimal test universe factory + entity builders.
 *
 * Seeds just enough data for integration tests: 2 regions, 3 systems,
 * all 12 goods with equilibrium markets, bidirectional connections.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { GOODS } from "@/lib/constants/goods";
import { getInitialStock, demandRateForGood } from "@/lib/constants/market-economy";
import { makeResourceVector, aggregateColumns } from "@/lib/engine/resources";
import type { Doctrine, GovernmentType, ResourceVector } from "@/lib/types/game";

// ── Types ────────────────────────────────────────────────────────

export interface TestUniverse {
  worldId: string;
  regions: { federation: string; corporate: string };
  factions: { federation: string; corporate: string };
  systems: { agricultural: string; industrial: string; tech: string };
  stations: { agricultural: string; industrial: string; tech: string };
  goodIds: Record<string, string>;
}

export interface TestPlayerOpts {
  credits?: number;
  email?: string;
  name?: string;
}

export interface TestPlayerResult {
  userId: string;
  playerId: string;
}

export interface TestShipOpts {
  playerId: string;
  systemId: string;
  name?: string;
  fuel?: number;
  maxFuel?: number;
  cargoMax?: number;
  speed?: number;
  hullMax?: number;
  hullCurrent?: number;
  shieldMax?: number;
  shieldCurrent?: number;
  firepower?: number;
  evasion?: number;
  stealth?: number;
  sensors?: number;
  status?: "docked" | "in_transit";
  destinationSystemId?: string;
  departureTick?: number;
  arrivalTick?: number;
  disabled?: boolean;
}

export interface TestTradeMissionOpts {
  systemId: string;
  destinationId: string;
  goodId: string;
  quantity?: number;
  reward?: number;
  deadlineTick?: number;
  createdAtTick?: number;
  playerId?: string | null;
  acceptedAtTick?: number | null;
  eventId?: string | null;
}

export interface TestOpMissionOpts {
  type: string;
  systemId: string;
  targetSystemId?: string;
  reward?: number;
  deadlineTick?: number;
  durationTicks?: number | null;
  enemyTier?: string | null;
  statRequirements?: string;
  createdAtTick?: number;
  status?: string;
  playerId?: string | null;
  shipId?: string | null;
  acceptedAtTick?: number | null;
  startedAtTick?: number | null;
}

export interface TestConvoyOpts {
  playerId: string;
  systemId: string;
  shipIds: string[];
  name?: string;
  status?: "docked" | "in_transit";
  destinationSystemId?: string | null;
  departureTick?: number | null;
  arrivalTick?: number | null;
}

// ── Seed test universe ───────────────────────────────────────────

let seedCounter = 0;

export async function seedTestUniverse(prisma: PrismaClient): Promise<TestUniverse> {
  seedCounter++;
  const prefix = `t${seedCounter}`;

  // Game world
  const world = await prisma.gameWorld.create({
    data: { id: "world", currentTick: 10, tickRate: 5000 },
  });

  // Regions — government does not live on the region; each test system gets its
  // government via its owning faction below.
  const fedRegion = await prisma.region.create({
    data: {
      name: `${prefix}-Federation Space`,
      dominantEconomy: "agricultural",
      x: 0,
      y: 0,
    },
  });

  const corpRegion = await prisma.region.create({
    data: {
      name: `${prefix}-Corporate Zone`,
      dominantEconomy: "industrial",
      x: 100,
      y: 0,
    },
  });

  // Representative substrates so the physical economy yields distinguishable
  // producer/consumer geography: arable/water mid-pop breadbasket, ore/mineral
  // populous forge, low-resource populous tech hub.
  const agriSubstrate = { aggregate: makeResourceVector({ arable: 10, water: 6, biomass: 4 }), population: 400 };
  const indSubstrate = { aggregate: makeResourceVector({ ore: 8, minerals: 8, gas: 3 }), population: 1500 };
  const techSubstrate = { aggregate: makeResourceVector({ water: 4, biomass: 1 }), population: 1500 };

  // Systems first (faction homeworld FK requires them to exist), then factions,
  // then bind systems to their owning faction.
  const agriSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Harvest Prime`,
      economyType: "agricultural",
      x: 10,
      y: 10,
      regionId: fedRegion.id,
      population: agriSubstrate.population,
      ...aggregateColumns(agriSubstrate.aggregate),
    },
  });

  const indSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Forge Station`,
      economyType: "industrial",
      x: 50,
      y: 10,
      regionId: corpRegion.id,
      population: indSubstrate.population,
      ...aggregateColumns(indSubstrate.aggregate),
    },
  });

  const techSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Nova Labs`,
      economyType: "tech",
      x: 90,
      y: 10,
      regionId: corpRegion.id,
      population: techSubstrate.population,
      ...aggregateColumns(techSubstrate.aggregate),
    },
  });

  // Two factions, one per region — Federation owns agri, Corporate owns ind+tech.
  const fedFaction = await createTestFaction(prisma, {
    name: `${prefix}-Federation`,
    governmentType: "federation",
    doctrine: "protectionist",
    homeworldId: agriSystem.id,
    color: "#3a82c8",
  });
  const corpFaction = await createTestFaction(prisma, {
    name: `${prefix}-Corporate`,
    governmentType: "corporate",
    doctrine: "mercantile",
    homeworldId: indSystem.id,
    color: "#d4a534",
  });

  // Two updateMany calls (one per owning faction) instead of three single-row
  // updates — symmetric with the live seed's bulk faction-binding pattern.
  await prisma.starSystem.updateMany({
    where: { id: agriSystem.id },
    data: { factionId: fedFaction },
  });
  await prisma.starSystem.updateMany({
    where: { id: { in: [indSystem.id, techSystem.id] } },
    data: { factionId: corpFaction },
  });

  // Bidirectional connections: agri ↔ ind ↔ tech
  await prisma.systemConnection.createMany({
    data: [
      { fromSystemId: agriSystem.id, toSystemId: indSystem.id, fuelCost: 10 },
      { fromSystemId: indSystem.id, toSystemId: agriSystem.id, fuelCost: 10 },
      { fromSystemId: indSystem.id, toSystemId: techSystem.id, fuelCost: 15 },
      { fromSystemId: techSystem.id, toSystemId: indSystem.id, fuelCost: 15 },
    ],
  });

  // Stations (one per system)
  const agriStation = await prisma.station.create({
    data: { name: `${prefix}-Harvest Station`, systemId: agriSystem.id },
  });

  const indStation = await prisma.station.create({
    data: { name: `${prefix}-Forge Market`, systemId: indSystem.id },
  });

  const techStation = await prisma.station.create({
    data: { name: `${prefix}-Nova Exchange`, systemId: techSystem.id },
  });

  // Goods (all 12, using GOODS constant for canonical data)
  const goodIds: Record<string, string> = {};
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
    goodIds[key] = good.id;
  }

  // Markets — each station gets all 12 goods seeded from its substrate net balance.
  const stationSystems: { stationId: string; aggregate: ResourceVector; population: number }[] = [
    { stationId: agriStation.id, ...agriSubstrate },
    { stationId: indStation.id, ...indSubstrate },
    { stationId: techStation.id, ...techSubstrate },
  ];

  for (const { stationId, aggregate, population } of stationSystems) {
    for (const key of Object.keys(GOODS)) {
      await prisma.stationMarket.create({
        data: {
          stationId,
          goodId: goodIds[key],
          stock: getInitialStock(aggregate, population, key),
          demandRate: demandRateForGood(key, population),
        },
      });
    }
  }

  return {
    worldId: world.id,
    regions: { federation: fedRegion.id, corporate: corpRegion.id },
    factions: { federation: fedFaction, corporate: corpFaction },
    systems: {
      agricultural: agriSystem.id,
      industrial: indSystem.id,
      tech: techSystem.id,
    },
    stations: {
      agricultural: agriStation.id,
      industrial: indStation.id,
      tech: techStation.id,
    },
    goodIds,
  };
}

// ── Faction helper ───────────────────────────────────────────────

export interface TestFactionOpts {
  name: string;
  homeworldId: string;
  governmentType?: GovernmentType;
  doctrine?: Doctrine;
  color?: string;
  description?: string;
  createdAtTick?: number;
}

export async function createTestFaction(
  prisma: PrismaClient,
  opts: TestFactionOpts,
): Promise<string> {
  const faction = await prisma.faction.create({
    data: {
      name: opts.name,
      description: opts.description ?? "",
      governmentType: opts.governmentType ?? "federation",
      doctrine: opts.doctrine ?? "protectionist",
      homeworldId: opts.homeworldId,
      color: opts.color ?? "#888888",
      createdAtTick: opts.createdAtTick ?? 0,
    },
  });
  return faction.id;
}

// ── Entity builders ──────────────────────────────────────────────

let playerCounter = 0;

export async function createTestPlayer(
  prisma: PrismaClient,
  opts: TestPlayerOpts = {},
): Promise<TestPlayerResult> {
  playerCounter++;
  const email = opts.email ?? `test-${playerCounter}@test.com`;
  const name = opts.name ?? `Player ${playerCounter}`;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: "test-hash-not-real",
    },
  });

  const player = await prisma.player.create({
    data: {
      userId: user.id,
      credits: opts.credits ?? 1000,
    },
  });

  return { userId: user.id, playerId: player.id };
}

export async function createTestShip(
  prisma: PrismaClient,
  opts: TestShipOpts,
): Promise<string> {
  const ship = await prisma.ship.create({
    data: {
      playerId: opts.playerId,
      systemId: opts.systemId,
      name: opts.name ?? "Test Ship",
      fuel: opts.fuel ?? 100,
      maxFuel: opts.maxFuel ?? 100,
      cargoMax: opts.cargoMax ?? 50,
      speed: opts.speed ?? 5,
      hullMax: opts.hullMax ?? 40,
      hullCurrent: opts.hullCurrent ?? opts.hullMax ?? 40,
      shieldMax: opts.shieldMax ?? 10,
      shieldCurrent: opts.shieldCurrent ?? opts.shieldMax ?? 10,
      firepower: opts.firepower ?? 2,
      evasion: opts.evasion ?? 6,
      stealth: opts.stealth ?? 3,
      sensors: opts.sensors ?? 4,
      status: opts.status ?? "docked",
      destinationSystemId: opts.destinationSystemId ?? null,
      departureTick: opts.departureTick ?? null,
      arrivalTick: opts.arrivalTick ?? null,
      disabled: opts.disabled ?? false,
    },
  });

  return ship.id;
}

export async function createTestTradeMission(
  prisma: PrismaClient,
  opts: TestTradeMissionOpts,
): Promise<string> {
  const mission = await prisma.tradeMission.create({
    data: {
      systemId: opts.systemId,
      destinationId: opts.destinationId,
      goodId: opts.goodId,
      quantity: opts.quantity ?? 10,
      reward: opts.reward ?? 500,
      deadlineTick: opts.deadlineTick ?? 200,
      createdAtTick: opts.createdAtTick ?? 10,
      playerId: opts.playerId ?? null,
      acceptedAtTick: opts.acceptedAtTick ?? null,
      eventId: opts.eventId ?? null,
    },
  });

  return mission.id;
}

export async function createTestOpMission(
  prisma: PrismaClient,
  opts: TestOpMissionOpts,
): Promise<string> {
  const mission = await prisma.mission.create({
    data: {
      type: opts.type,
      systemId: opts.systemId,
      targetSystemId: opts.targetSystemId ?? opts.systemId,
      reward: opts.reward ?? 1000,
      deadlineTick: opts.deadlineTick ?? 200,
      durationTicks: opts.durationTicks ?? null,
      enemyTier: opts.enemyTier ?? null,
      statRequirements: opts.statRequirements ?? "{}",
      createdAtTick: opts.createdAtTick ?? 10,
      status: opts.status ?? "available",
      playerId: opts.playerId ?? null,
      shipId: opts.shipId ?? null,
      acceptedAtTick: opts.acceptedAtTick ?? null,
      startedAtTick: opts.startedAtTick ?? null,
    },
  });

  return mission.id;
}

export async function createTestConvoy(
  prisma: PrismaClient,
  opts: TestConvoyOpts,
): Promise<string> {
  const convoy = await prisma.convoy.create({
    data: {
      playerId: opts.playerId,
      systemId: opts.systemId,
      name: opts.name ?? "Test Convoy",
      status: opts.status ?? "docked",
      destinationSystemId: opts.destinationSystemId ?? null,
      departureTick: opts.departureTick ?? null,
      arrivalTick: opts.arrivalTick ?? null,
      members: {
        create: opts.shipIds.map((shipId) => ({ shipId })),
      },
    },
  });

  return convoy.id;
}
