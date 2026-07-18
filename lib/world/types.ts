/**
 * World-state types — the hand-owned, in-memory model of the whole game
 * universe. No Prisma dependency; every field is a plain string/number/
 * boolean/array/object so the whole `World` survives
 * `JSON.parse(JSON.stringify(world))` (save/load round-trips through this).
 *
 * Entities are stored as flat top-level arrays keyed by id (or a natural
 * composite key), not nested — the same normalized shape as the relational
 * schema this superseded. A row keeps its own synthetic `id` only when
 * something else references it by id; rows with a natural composite key
 * that nothing else points to (buildings, connections, markets,
 * relations, alliance pacts) are keyed by that natural key instead.
 */

import type {
  BodyArchetypeId,
  Doctrine,
  EconomyType,
  GovernmentType,
  ShipStatus,
  SunClass,
} from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

// ── Meta ────────────────────────────────────────────────────────

export interface WorldMeta {
  seed: number;
  systemCount: number;
  mapSize: number;
  currentTick: number;
}

// ── Player ──────────────────────────────────────────────────────

/** The human seat: which faction the player controls. Null in a playerless world (the
 *  calibration harness). Everything else player-specific hangs off the controlled faction. */
export interface WorldPlayer {
  controlledFactionId: string;
}

// ── Regions ─────────────────────────────────────────────────────

export interface WorldRegion {
  id: string;
  name: string;
  /** Most common economy type among the region's systems. */
  dominantEconomy: EconomyType;
  x: number;
  y: number;
}

// ── Systems ─────────────────────────────────────────────────────

/** Three-state system ownership. `unclaimed` = empty frontier (factionId null); `controlled` =
 * owned, border-closing, inert until developed; `developed` = development builds are allowed. */
export type SystemControl = "unclaimed" | "controlled" | "developed";

export interface WorldSystem {
  id: string;
  name: string;
  economyType: EconomyType;
  x: number;
  y: number;
  description: string;
  regionId: string;
  /** Owning faction's id, or null for independent systems. */
  factionId: string | null;
  /** Three-state ownership: unclaimed frontier → controlled (outpost tier) → developed (build-gate). */
  control: SystemControl;
  isGateway: boolean;

  // ── Physical substrate ──
  sunClass: SunClass;
  /** Abstract population magnitude. */
  population: number;
  /** Maximum sustainable population. */
  popCap: number;
  /** 0…1 — integral of demand-weighted dissatisfaction. */
  unrest: number;
  /** Sum of body-archetype danger baselines. */
  bodyDanger: number;
  /** SPACE_PER_SIZE × Σ size. */
  availableSpace: number;
  /** Fungible (non-deposit) space. */
  generalSpace: number;
  /** Habitable fraction of general space — caps population centres. */
  habitableSpace: number;
  /** Extractor-slot caps, one per resource. */
  slotGas: number;
  slotMinerals: number;
  slotOre: number;
  slotBiomass: number;
  slotArable: number;
  slotWater: number;
  slotRadioactive: number;
  /** Effective quality multipliers, one per resource. */
  yieldGas: number;
  yieldMinerals: number;
  yieldOre: number;
  yieldBiomass: number;
  yieldArable: number;
  yieldWater: number;
  yieldRadioactive: number;
}

// ── Bodies ──────────────────────────────────────────────────────

export interface WorldBody {
  id: string;
  systemId: string;
  bodyType: BodyArchetypeId;
  habitable: boolean;
  size: number;
  /** This body's general (non-deposit) space. */
  generalSpace: number;
  /** This body's habitable space. */
  habitableSpace: number;
  /** Per-body slot counts, one per resource (0 = no deposit). */
  slotGas: number;
  slotMinerals: number;
  slotOre: number;
  slotBiomass: number;
  slotArable: number;
  slotWater: number;
  slotRadioactive: number;
  /** Per-body quality multipliers, one per resource (0 = no deposit). */
  qualGas: number;
  qualMinerals: number;
  qualOre: number;
  qualBiomass: number;
  qualArable: number;
  qualWater: number;
  qualRadioactive: number;
}

// ── Buildings / connections ─────────────────────────────────────

export interface WorldBuilding {
  systemId: string;
  /** Production-good type id, or "housing" | "vocational_school" | "research_institute". */
  buildingType: string;
  /** Whole-integer level count. Grows only via landed construction projects; sheds whole levels via decay. */
  count: number;
  /** Sustained-idle countdown for this (system, type): counts up while ≥1 whole level sits idle, resets on refill, sheds one level at the decay buffer. */
  idleMonths: number;
  /** Fractional unrest-collapse accumulator for this (system, type); whole levels tear down as it crosses integers. Absent in pre-cadence saves ⇒ 0. */
  collapseDebt?: number;
}

/** Fields every committed construction project shares — funded by `factionId`'s per-pulse pool. */
interface WorldConstructionProjectBase {
  id: string;
  factionId: string;
  systemId: string;
  /** Total construction work to complete. */
  workTotal: number;
  /** Construction points accumulated so far, in [0, workTotal]. */
  workDone: number;
}

/**
 * A queued order to build `levels` whole levels of `buildingType` at `systemId`. Contributes zero
 * capacity until `workDone` reaches `workTotal`, then lands all `levels` at once. Duration is emergent
 * (work ÷ funded points), never a stored timer.
 */
export interface WorldBuildProject extends WorldConstructionProjectBase {
  kind: "build";
  buildingType: string;
  /** Whole levels this project lands on completion (integer ≥ 1). */
  levels: number;
}

/**
 * A queued order to establish a colony at controlled `systemId` (docs/planned/economy-colonisation-cost.md
 * §1-2). On completion the system flips `developed`, receives the conserved `seedPop` transferred from
 * `sourceSystemId` (capped at apply time by the source's population), and lands `housingLevels` of housing
 * bundled with it — so `popCap ≥ seedPop` on arrival (viable by construction). `seedPop`/`housingLevels`
 * are fixed at proposal time (sized to the colony's habitable land) and never recomputed.
 */
export interface WorldColonyEstablishProject extends WorldConstructionProjectBase {
  kind: "colony_establish";
  /** Nearest developed same-faction system the seed population transfers from (fixed for the project's life). */
  sourceSystemId: string;
  /** Conserved starter population, sized at proposal to the whole-level habitable cap. */
  seedPop: number;
  /** Housing levels placed with the colony (houses the seed pop; land-bounded). */
  housingLevels: number;
}

/**
 * One committed construction project. A discriminated union: ordinary `build` levels, or a
 * `colony_establish` that lands a viable colony. Both are funded from the same per-faction throughput
 * pool by the same `fundQueue`, so build-vs-colonise arbitrates on one budget.
 */
export type WorldConstructionProject = WorldBuildProject | WorldColonyEstablishProject;

export interface WorldConnection {
  fromId: string;
  toId: string;
  fuelCost: number;
}

// ── Markets ─────────────────────────────────────────────────────

/** One (system, good) market row. Good catalog data (basePrice, floor/ceiling) lives in code constants, not here. */
export interface WorldMarket {
  systemId: string;
  goodId: string;
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult: number;
  /**
   * Total days-of-supply demand denominator: civilian consumption **plus** industrial input draw.
   * This is the pricing anchor (targetStock = TARGET_COVER × demandRate) and the directed-logistics
   * deficit anchor — NOT the civilian-only footprint the Population panel renders (that is
   * `civilianDemandRateForGood`). Recomputed each economy pulse by the population processor via
   * `totalDemandRateForGood`; seeded civilian-only at world-gen and overwritten with the
   * civilian+industrial total on the first pulse.
   */
  demandRate: number;
  /** Infrastructure storage capacity for this good from the system's built buildings. */
  storageCapacity: number;
}

// ── Factions ────────────────────────────────────────────────────

export interface WorldFaction {
  id: string;
  name: string;
  description: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
  /** One homeworld per faction. */
  homeworldId: string;
  /** Hex color (with leading #) for territory rendering. */
  color: string;
  createdAtTick: number;
}

/** One ring-buffer entry recording a recent relation-score drift driver. */
export interface WorldRelationHistoryEntry {
  tick: number;
  delta: number;
  /** Compact summary, e.g. "border-friction:-0.04, alliance:+0.15". */
  drivers: string;
}

/** Pairwise relation score between two factions. Convention: factionAId < factionBId. */
export interface WorldFactionRelation {
  factionAId: string;
  factionBId: string;
  /** [-100, +100]. */
  score: number;
  history: WorldRelationHistoryEntry[];
  updatedAtTick: number;
}

/** Active alliance between a pair of factions. Convention: factionAId < factionBId. */
export interface WorldAlliancePact {
  factionAId: string;
  factionBId: string;
  formedAtTick: number;
  pendingDissolutionAtTick: number | null;
}

// ── Events ──────────────────────────────────────────────────────

/** Participant pair carried by relations-spawned events (border_conflict, pact_under_negotiation, alliance_dissolved). */
export interface WorldEventMetadata {
  factionAId: string;
  factionBId: string;
  expiresAtTick: number;
}

export interface WorldEvent {
  id: string;
  type: EventTypeId;
  /** Current phase name, e.g. "tensions", "active". */
  phase: string;
  /** Target system, or null for region-level events. */
  systemId: string | null;
  /** Target region, or null. */
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  /** Intensity multiplier (spread events are weaker). */
  severity: number;
  /** Parent event, for spread events. */
  sourceEventId: string | null;
  /** Only populated for relations-spawned events. */
  metadata: WorldEventMetadata | null;
}

export interface WorldEventModifier {
  eventId: string;
  /** "economy" today; open-ended for future layers (war, reputation). */
  domain: string;
  /** "anchor_shift", "rate_multiplier", "equilibrium_shift". */
  type: string;
  /** "system" or "region". */
  targetType: string;
  targetId: string | null;
  /** Specific good key, or null for all goods. */
  goodId: string | null;
  /** "target_stock", "production_rate", "consumption_rate". */
  parameter: string;
  value: number;
}

// ── Ships ───────────────────────────────────────────────────────

/** Ownerless in Phase 2 — no playerId. */
export interface WorldShip {
  id: string;
  name: string;
  shipType: string;
  fuel: number;
  maxFuel: number;
  speed: number;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
  stealth: number;
  sensors: number;
  crewCapacity: number;
  disabled: boolean;
  status: ShipStatus;
  systemId: string;
  destinationSystemId: string | null;
  departureTick: number | null;
  arrivalTick: number | null;
}

// ── Trade flow log ──────────────────────────────────────────────

export interface WorldFlowEvent {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

// ── World ───────────────────────────────────────────────────────

export interface World {
  meta: WorldMeta;
  /** The human player's seat, or null for a playerless (harness-generated) world. */
  player: WorldPlayer | null;
  regions: WorldRegion[];
  systems: WorldSystem[];
  bodies: WorldBody[];
  buildings: WorldBuilding[];
  /** Open (in-flight) construction projects across all factions; a landed/completed project is removed. */
  constructionProjects: WorldConstructionProject[];
  connections: WorldConnection[];
  markets: WorldMarket[];
  factions: WorldFaction[];
  relations: WorldFactionRelation[];
  alliancePacts: WorldAlliancePact[];
  events: WorldEvent[];
  modifiers: WorldEventModifier[];
  ships: WorldShip[];
  /** Rolling window of directed-logistics flow events; pruned to the retention window by the tick body. */
  flowEvents: WorldFlowEvent[];
  /** Monotonic counter for generating unique ids. */
  nextId: number;
}
