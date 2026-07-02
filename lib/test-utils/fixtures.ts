/**
 * Minimal test universe factory + entity builders.
 *
 * Seeds just enough data for integration tests: 2 regions, 3 systems,
 * all goods with equilibrium markets, bidirectional connections.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { GOODS } from "@/lib/constants/goods";
import { getInitialStock, demandRateForGood } from "@/lib/constants/market-economy";
import { makeResourceVector, emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { Doctrine, GovernmentType, ResourceVector } from "@/lib/types/game";
import { allocateIndustry } from "@/lib/engine/industry-seed";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { mulberry32 } from "@/lib/engine/universe-gen";

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
  const agriSubstrate = { slots: makeResourceVector({ arable: 10, water: 6, biomass: 4 }), population: 400 };
  const indSubstrate = { slots: makeResourceVector({ ore: 8, minerals: 8, gas: 3 }), population: 1500 };
  const techSubstrate = { slots: makeResourceVector({ water: 4, biomass: 1 }), population: 1500 };

  // Systems first (faction homeworld FK requires them to exist), then factions,
  // then bind systems to their owning faction.
  //
  // Each system gets a deterministic industrial allocation so integration tests
  // have building rows available. The available-space seeder takes per-body
  // deposit slots + quality; model each substrate as a single body whose deposit
  // slots equal its slot vector (uniform quality 1.0), with a coarse general /
  // habitable budget. Fixed seeds (101/102/103) keep allocations stable.
  const COARSE_GENERAL_SPACE = 120;
  const allocateFromSlots = (slots: ResourceVector, seed: number) => {
    const quality = emptyResourceVector();
    for (const r of RESOURCE_TYPES) {
      if (slots[r] > 0) quality[r] = 1.0;
    }
    return allocateIndustry(
      {
        bodies: [{ slots, quality }],
        slotCap: slots,
        generalSpace: COARSE_GENERAL_SPACE,
        habitableSpace: COARSE_GENERAL_SPACE * 0.6,
        fill: 0.8,
      },
      mulberry32(seed),
    );
  };
  const agriAllocation = allocateFromSlots(agriSubstrate.slots, 101);
  const indAllocation = allocateFromSlots(indSubstrate.slots, 102);
  const techAllocation = allocateFromSlots(techSubstrate.slots, 103);

  const agriSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Harvest Prime`,
      economyType: "agricultural",
      x: 10,
      y: 10,
      regionId: fedRegion.id,
      population: agriSubstrate.population,
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
    },
  });

  // Batch-create building rows for all three systems — one row per
  // (system, buildingType) with count > 0.
  const fixtureBuildingData = [
    { systemId: agriSystem.id, buildings: agriAllocation.buildings },
    { systemId: indSystem.id, buildings: indAllocation.buildings },
    { systemId: techSystem.id, buildings: techAllocation.buildings },
  ].flatMap(({ systemId, buildings }) =>
    Object.entries(buildings)
      .filter(([, count]) => count > 0)
      .map(([buildingType, count]) => ({ systemId, buildingType, count })),
  );
  await prisma.systemBuilding.createMany({ data: fixtureBuildingData });

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

  // Goods (all goods, using GOODS constant for canonical data). Batched into one
  // createManyAndReturn; returned ids map back to each good's slug by name.
  const slugByGoodName = new Map(Object.entries(GOODS).map(([key, def]) => [def.name, key]));
  const createdGoods = await prisma.good.createManyAndReturn({
    data: Object.values(GOODS).map((def) => ({
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
    })),
    select: { id: true, name: true },
  });
  const goodIds: Record<string, string> = {};
  for (const g of createdGoods) {
    const key = slugByGoodName.get(g.name);
    if (key) goodIds[key] = g.id;
  }

  // Markets — each station gets all goods seeded from its capacity-driven net
  // balance (seeded buildings × per-resource yield). The fixtures model deposits
  // at uniform quality 1.0, so yields are the neutral unit vector. Batched into
  // one createMany across every (station, good) pair.
  const stationSystems: {
    stationId: string;
    buildings: Record<string, number>;
    yieldMult: ResourceVector;
    population: number;
  }[] = [
    { stationId: agriStation.id, buildings: agriAllocation.buildings, yieldMult: unitResourceVector(), population: agriSubstrate.population },
    { stationId: indStation.id, buildings: indAllocation.buildings, yieldMult: unitResourceVector(), population: indSubstrate.population },
    { stationId: techStation.id, buildings: techAllocation.buildings, yieldMult: unitResourceVector(), population: techSubstrate.population },
  ];

  const marketData = stationSystems.flatMap(({ stationId, buildings, yieldMult, population }) => {
    const demandBasis = computeSystemLabourSnapshot(buildings, population).basis;
    return Object.keys(GOODS).map((key) => ({
      stationId,
      goodId: goodIds[key],
      stock: getInitialStock(buildings, yieldMult, population, key),
      demandRate: demandRateForGood(key, demandBasis),
    }));
  });
  await prisma.stationMarket.createMany({ data: marketData });

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
