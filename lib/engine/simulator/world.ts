/**
 * Create an in-memory SimWorld from procedural generation.
 * Uses the same universe-gen engine as the real game.
 */

import {
  generateUniverse,
  type GenParams,
} from "@/lib/engine/universe-gen";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import { GOODS } from "@/lib/constants/goods";
import type { SimConstants } from "./constants";
import type {
  SimWorld,
  SimConfig,
  SimRegion,
  SimSystem,
  SimConnection,
  SimMarketEntry,
  SimShip,
  SimPlayer,
} from "./types";

/**
 * Build GenParams from constants + the standard universe-gen layout constants.
 * Only the tunable subset comes from SimConstants; layout constants
 * (mapSize, scatterRadius, etc.) stay fixed from UNIVERSE_GEN.
 */
export function buildGenParams(seed: number, universe: SimConstants["universe"]): GenParams {
  return {
    seed,
    regionCount: universe.regionCount,
    systemsPerRegion: universe.systemsPerRegion,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    systemScatterRadius: UNIVERSE_GEN.SYSTEM_SCATTER_RADIUS,
    systemMinDistance: UNIVERSE_GEN.SYSTEM_MIN_DISTANCE,
    extraEdgeFraction: universe.intraRegionExtraEdges,
    gatewayFuelMultiplier: universe.gatewayFuelMultiplier,
    intraRegionBaseFuel: universe.intraRegionBaseFuel,
    maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
  };
}

/**
 * Create an in-memory world with markets at equilibrium and bot players.
 */
export function createSimWorld(config: SimConfig, constants: SimConstants): SimWorld {
  const params = buildGenParams(config.seed, constants.universe);
  const universe = generateUniverse(params, REGION_NAMES);

  // Build regions
  const regions: SimRegion[] = universe.regions.map((r, i) => ({
    id: `region-${i}`,
    name: r.name,
    governmentType: r.governmentType,
  }));

  // Build systems
  const systems: SimSystem[] = universe.systems.map((s, i) => {
    const econ = s.economyType;
    return {
      id: `system-${i}`,
      name: s.name,
      economyType: econ,
      regionId: `region-${s.regionIndex}`,
      produces: ECONOMY_PRODUCTION[econ] ?? {},
      consumes: ECONOMY_CONSUMPTION[econ] ?? {},
      traits: s.traits.map((t) => ({ traitId: t.traitId, quality: t.quality })),
    };
  });

  // Build connections
  const connections: SimConnection[] = universe.connections.map((c) => ({
    fromSystemId: `system-${c.fromSystemIndex}`,
    toSystemId: `system-${c.toSystemIndex}`,
    fuelCost: c.fuelCost,
  }));

  // Build markets — every system gets every good at equilibrium
  const markets: SimMarketEntry[] = [];
  const goodEntries = Object.entries(GOODS);

  for (const sys of systems) {
    for (const [goodKey, goodDef] of goodEntries) {
      const isProduced = goodKey in sys.produces;
      const isConsumed = goodKey in sys.consumes;
      const goodConst = constants.goods[goodKey];
      const goodEq = goodConst?.equilibrium;

      const target = isProduced
        ? (goodEq?.produces ?? constants.equilibrium.produces)
        : isConsumed
          ? (goodEq?.consumes ?? constants.equilibrium.consumes)
          : constants.equilibrium.neutral;

      // Use overridden base price if available, otherwise the good definition's price
      const basePrice = goodConst?.basePrice ?? goodDef.basePrice;

      markets.push({
        systemId: sys.id,
        goodId: goodKey,
        basePrice,
        supply: target.supply,
        demand: target.demand,
        priceFloor: goodConst?.priceFloor ?? goodDef.priceFloor,
        priceCeiling: goodConst?.priceCeiling ?? goodDef.priceCeiling,
      });
    }
  }

  // Build bot players and ships
  const startingSystemId = `system-${universe.startingSystemIndex}`;
  const players: SimPlayer[] = [];
  const ships: SimShip[] = [];
  let nextId = 0;

  const shuttleStats = constants.ships.shuttle ?? { fuel: 100, cargo: 50, speed: 5, hullMax: 40, shieldMax: 10, firepower: 2, evasion: 6, stealth: 3, price: 0 };

  for (const botCfg of config.bots) {
    for (let i = 0; i < botCfg.count; i++) {
      const playerId = `player-${nextId}`;
      const shipId = `ship-${nextId}`;

      players.push({
        id: playerId,
        name: `${botCfg.strategy}-${i}`,
        credits: constants.bots.startingCredits,
        strategy: botCfg.strategy,
      });

      ships.push({
        id: shipId,
        playerId,
        shipType: "shuttle",
        fuel: shuttleStats.fuel,
        maxFuel: shuttleStats.fuel,
        cargo: [],
        cargoMax: shuttleStats.cargo,
        speed: shuttleStats.speed,
        hullMax: shuttleStats.hullMax,
        hullCurrent: shuttleStats.hullMax,
        shieldMax: shuttleStats.shieldMax,
        firepower: shuttleStats.firepower,
        evasion: shuttleStats.evasion,
        stealth: shuttleStats.stealth,
        disabled: false,
        status: "docked",
        systemId: startingSystemId,
        destinationSystemId: null,
        arrivalTick: null,
      });

      nextId++;
    }
  }

  return {
    tick: 0,
    regions,
    systems,
    connections,
    markets,
    events: [],
    modifiers: [],
    ships,
    players,
    nextId,
  };
}
