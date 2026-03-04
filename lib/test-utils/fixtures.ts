/**
 * Minimal test universe factory + entity builders.
 *
 * Seeds just enough data for integration tests: 2 regions, 3 systems,
 * all 12 goods with equilibrium markets, bidirectional connections.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { GOODS } from "@/lib/constants/goods";

// ── Types ────────────────────────────────────────────────────────

export interface TestUniverse {
  worldId: string;
  regions: { federation: string; corporate: string };
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

// ── Seed test universe ───────────────────────────────────────────

let seedCounter = 0;

export async function seedTestUniverse(prisma: PrismaClient): Promise<TestUniverse> {
  seedCounter++;
  const prefix = `t${seedCounter}`;

  // Game world
  const world = await prisma.gameWorld.create({
    data: { id: "world", currentTick: 10, tickRate: 5000 },
  });

  // Regions
  const fedRegion = await prisma.region.create({
    data: {
      name: `${prefix}-Federation Space`,
      governmentType: "federation",
      dominantEconomy: "agricultural",
      x: 0,
      y: 0,
    },
  });

  const corpRegion = await prisma.region.create({
    data: {
      name: `${prefix}-Corporate Zone`,
      governmentType: "corporate",
      dominantEconomy: "industrial",
      x: 100,
      y: 0,
    },
  });

  // Systems (one per economy type we commonly test)
  const agriSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Harvest Prime`,
      economyType: "agricultural",
      x: 10,
      y: 10,
      regionId: fedRegion.id,
    },
  });

  const indSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Forge Station`,
      economyType: "industrial",
      x: 50,
      y: 10,
      regionId: corpRegion.id,
    },
  });

  const techSystem = await prisma.starSystem.create({
    data: {
      name: `${prefix}-Nova Labs`,
      economyType: "tech",
      x: 90,
      y: 10,
      regionId: corpRegion.id,
    },
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

  // Markets — each station gets all 12 goods at equilibrium
  const stationSystems: { stationId: string; economyType: string }[] = [
    { stationId: agriStation.id, economyType: "agricultural" },
    { stationId: indStation.id, economyType: "industrial" },
    { stationId: techStation.id, economyType: "tech" },
  ];

  for (const { stationId, economyType } of stationSystems) {
    for (const [key, def] of Object.entries(GOODS)) {
      // Determine relationship: does this economy produce or consume this good?
      const { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } = await import("@/lib/constants/universe");
      const econ = economyType as keyof typeof ECONOMY_PRODUCTION;
      const produces = key in (ECONOMY_PRODUCTION[econ] ?? {});
      const consumes = key in (ECONOMY_CONSUMPTION[econ] ?? {});

      let supply: number;
      let demand: number;
      if (produces) {
        supply = def.equilibrium.produces.supply;
        demand = def.equilibrium.produces.demand;
      } else if (consumes) {
        supply = def.equilibrium.consumes.supply;
        demand = def.equilibrium.consumes.demand;
      } else {
        // Neutral — balanced supply/demand
        supply = 60;
        demand = 60;
      }

      await prisma.stationMarket.create({
        data: {
          stationId,
          goodId: goodIds[key],
          supply,
          demand,
        },
      });
    }
  }

  return {
    worldId: world.id,
    regions: { federation: fedRegion.id, corporate: corpRegion.id },
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
