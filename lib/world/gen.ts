/**
 * Pure world generation — composes `generateUniverse` with the post-generation
 * derivations (markets, factions, relations, ships), producing a fully-populated
 * in-memory `World` directly. Every synthetic id is minted from a monotonic counter,
 * so a given seed yields a byte-identical world.
 */

import { createSystemMarkets } from "@/lib/world/markets";
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { deriveDominantEconomy, type PlayerFactionInput } from "@/lib/engine/faction-gen";
import { countColumns, qualColumns, yieldColumns, effColumns } from "@/lib/engine/resources";
import { genConfigForSystemCount, REGION_NAMES } from "@/lib/constants/universe-gen";
import { DEFAULT_TAX_LEVEL } from "@/lib/constants/treasury";
import { DEFAULT_ALERT_CATEGORIES, DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import type {
  World,
  WorldRegion,
  WorldSystem,
  WorldBody,
  WorldBuilding,
  WorldConnection,
  WorldMarket,
  WorldFaction,
  WorldFactionRelation,
  WorldFactionTreasury,
  WorldPlayer,
} from "./types";

export interface GenerateWorldOptions {
  systemCount: number;
  seed: number;
  playerFaction?: PlayerFactionInput;
}

/**
 * Monotonic id-minting counter threaded through generation, so `World.nextId`
 * lands at the final value once every mintable entity (region/system/body/
 * faction) has been assigned one.
 */
interface IdMinter {
  next: number;
}

function mintId(minter: IdMinter, prefix: string): string {
  const id = `${prefix}-${minter.next}`;
  minter.next += 1;
  return id;
}

/**
 * Build `generateUniverse`'s params from a fully-interpolated universe-gen
 * config (`genConfigForSystemCount`). `seed` comes from the caller — the config's
 * own `SEED` stays pinned at the `BASE_CONFIG` default and is not the per-world seed.
 */
export function buildGenParams(
  seed: number,
  config: ReturnType<typeof genConfigForSystemCount>,
): GenParams {
  return {
    seed,
    regionCount: config.REGION_COUNT,
    totalSystems: config.TOTAL_SYSTEMS,
    mapSize: config.MAP_SIZE,
    mapPadding: config.MAP_PADDING,
    poissonMinDistance: config.POISSON_MIN_DISTANCE,
    poissonKCandidates: config.POISSON_K_CANDIDATES,
    regionMinDistance: config.REGION_MIN_DISTANCE,
    extraEdgeFraction: config.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: config.GATEWAY_FUEL_MULTIPLIER,
    gatewaysPerBorder: config.GATEWAYS_PER_BORDER,
    intraRegionBaseFuel: config.INTRA_REGION_BASE_FUEL,
    maxPlacementAttempts: config.MAX_PLACEMENT_ATTEMPTS,
    minorFactionCount: config.MINOR_FACTION_COUNT,
  };
}

/**
 * Generate a fresh in-memory `World` for a new single-player game. Pure and
 * deterministic: the same `{ systemCount, seed }` always produces the same
 * world (byte-for-byte through JSON), and every random draw flows from
 * `generateUniverse`'s own seeded RNG — nothing here calls `Math.random()`,
 * `Date.now()`, or touches the filesystem/DB.
 */
export function generateWorld(options: GenerateWorldOptions): World {
  const { systemCount, seed } = options;
  const config = genConfigForSystemCount(systemCount);
  const params = buildGenParams(seed, config);
  const universe = generateUniverse(params, REGION_NAMES, options.playerFaction);

  const minter: IdMinter = { next: 0 };

  // ── Regions ──
  const regionIds = universe.regions.map(() => mintId(minter, "region"));
  const regions: WorldRegion[] = universe.regions.map((r, i) => ({
    id: regionIds[i],
    name: r.name,
    dominantEconomy: deriveDominantEconomy(
      universe.systems.filter((s) => s.regionIndex === i),
    ),
    x: r.x,
    y: r.y,
  }));

  // ── Systems + factions share id-mintng order with seed.ts's insert order
  // (systems, then factions whose homeworldId references a system id) ──
  const systemIds = universe.systems.map(() => mintId(minter, "system"));
  const factionIds = universe.factions.map(() => mintId(minter, "faction"));

  const factions: WorldFaction[] = universe.factions.map((f, i) => ({
    id: factionIds[i],
    name: f.name,
    description: f.description,
    governmentType: f.governmentType,
    doctrine: f.doctrine,
    homeworldId: systemIds[f.homeworldSystemIndex],
    color: f.color,
    createdAtTick: 0,
  }));

  const systems: WorldSystem[] = universe.systems.map((s, i) => ({
    id: systemIds[i],
    name: s.name,
    economyType: s.economyType,
    x: s.x,
    y: s.y,
    description: s.description,
    regionId: regionIds[s.regionIndex],
    factionId:
      universe.systemFactionAssignments[s.index] === -1
        ? null
        : factionIds[universe.systemFactionAssignments[s.index]],
    control:
      universe.systemFactionAssignments[s.index] === -1 ? "unclaimed" : "developed",
    isGateway: s.isGateway,
    sunClass: s.sunClass,
    population: s.population,
    popCap: s.popCap,
    unrest: 0,
    bodyDanger: s.bodyDanger,
    peopleLand: s.peopleLand,
    ...countColumns(s.depositCounts),
    ...yieldColumns(s.yieldMult),
    ...effColumns(s.extractionEfficiency),
  }));

  // ── Bodies ──
  const bodies: WorldBody[] = universe.systems.flatMap((s, i) =>
    s.bodies.map((b) => ({
      id: mintId(minter, "body"),
      systemId: systemIds[i],
      bodyType: b.bodyType,
      size: b.size,
      peopleLand: b.peopleLand,
      ...countColumns(b.counts),
      ...qualColumns(b.quality),
    })),
  );

  // ── Buildings (one row per (system, buildingType) with count > 0) ──
  const buildings: WorldBuilding[] = universe.systems.flatMap((s, i) =>
    Object.entries(s.buildings)
      .filter(([, count]) => count > 0)
      .map(([buildingType, count]) => ({
        systemId: systemIds[i],
        buildingType,
        count,
        idleCycles: 0,
      })),
  );

  // ── Connections (already bidirectional from the generator) ──
  const connections: WorldConnection[] = universe.connections.map((c) => ({
    fromId: systemIds[c.fromSystemIndex],
    toId: systemIds[c.toSystemIndex],
    fuelCost: c.fuelCost,
  }));

  // ── Markets (developed systems only) ──
  // An unclaimed system has no market: no one there produces, consumes, or stores anything. Rows are
  // created when a system is settled (`lib/world/tick.ts`), opening empty. Seeding every rock would
  // hand each future colony a full anchor's worth of goods nobody grew, and would swamp every
  // galaxy-wide market reading with rows that can never move.
  const markets: WorldMarket[] = universe.systems.flatMap((s, i) => {
    if (systems[i].control !== "developed") return [];
    return createSystemMarkets({
      systemId: systemIds[i],
      buildings: s.buildings,
      yields: s.yieldMult,
      population: s.population,
      seedStock: true,
    });
  });

  // ── Faction relations (all pairs, canonical factionAId < factionBId) ──
  const relations: WorldFactionRelation[] = [];
  for (let i = 0; i < factionIds.length; i++) {
    for (let j = i + 1; j < factionIds.length; j++) {
      const a = factionIds[i];
      const b = factionIds[j];
      const [factionAId, factionBId] = a < b ? [a, b] : [b, a];
      relations.push({ factionAId, factionBId, score: 0, history: [], updatedAtTick: 0 });
    }
  }

  // ── Treasuries (zero start — solvency is a calibration outcome, not a handout) ──
  const treasuries: WorldFactionTreasury[] = factions.map((f) => ({
    factionId: f.id,
    balance: 0,
    taxLevel: DEFAULT_TAX_LEVEL[f.governmentType],
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    pendingFounding: 0,
    lastSettlement: null,
    updatedAtTick: 0,
  }));

  // Spread rather than referenced: the two settings records are module-level constants, and a world
  // holding the constant itself would share one object across every world generated in this process.
  const player: WorldPlayer | null =
    universe.playerFactionIndex !== null
      ? {
          controlledFactionId: factionIds[universe.playerFactionIndex],
          automation: { build: true, colonisation: true },
          pinnedSystemIds: [],
          alertCategories: { ...DEFAULT_ALERT_CATEGORIES },
          trackerSections: { ...DEFAULT_TRACKER_SECTIONS },
        }
      : null;

  return {
    meta: {
      seed,
      systemCount: config.TOTAL_SYSTEMS,
      mapSize: config.MAP_SIZE,
      currentTick: 0,
    },
    player,
    regions,
    systems,
    bodies,
    buildings,
    constructionProjects: [],
    connections,
    markets,
    factions,
    relations,
    treasuries,
    // No war/diplomacy/ship/trade-flow state at generation time — Phase 3+ builds these up at runtime.
    alliancePacts: [],
    events: [],
    modifiers: [],
    ships: [],
    flowEvents: [],
    nextId: minter.next,
  };
}
