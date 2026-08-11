/**
 * World-state types — the hand-owned, in-memory model of the whole game
 * universe. Every field is a plain string/number/
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
  TaxLevel,
} from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";
import type { MaintenanceBillLine, TreasuryBands } from "@/lib/engine/treasury";
import type { SupplyRegime } from "@/lib/engine/population";

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
  /** Per-domain autonomic switches. Off = the planner stops PROPOSING in that domain for the player's
   *  faction; committed funding and manual orders always continue. AI factions never read this. */
  automation: { build: boolean; colonisation: boolean };
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
  /** 0…1 — integral of necessity-weighted dissatisfaction. */
  unrest: number;
  /** Fractional unrest-collapse accumulator; whole levels tear down as it crosses integers, and it
   *  resets whenever unrest falls back to the decay threshold. Absent ⇒ 0, so world-gen and older
   *  saves both omit it: the debt is transient regime state, not an accrued balance. */
  collapseDebt?: number;
  /** 0…1 — the stored memory of the Provision this population has grown accustomed to (adaptive
   *  expectation; docs/active/gameplay/economy.md, unrest's supply term). Absent means never
   *  seeded — load-bearing, and deliberately NOT the `collapseDebt` "absent ⇒ 0" convention just
   *  above: coercing absence to 0 here would read as "remembers total collapse" and destroy the
   *  lazy first-use seed that world-gen, colony founding and old saves all rely on. Cleared
   *  whenever the system transitions into `developed` (resettlement seeds fresh —
   *  `applyDevelopments`, `lib/world/tick.ts`). */
  provisionExpectation?: number;
  /** This cycle's Provisioned — the necessity-weighted delivered share (`provision()`,
   *  lib/engine/population.ts), the exact complement of the dissatisfaction the population
   *  processor's unrest read consumed the same cycle. A read-side recompute cannot honestly
   *  reach `consumptionMult` (an event-only demand modifier with no read-side path), so this is
   *  persisted at the point of assessment instead — the same reason `satisfaction` is persisted
   *  (`:270` below), so the display and the sim cannot diverge. Absent means never assessed —
   *  deliberately NOT the `collapseDebt` "absent ⇒ 0" convention above (matches
   *  `provisionExpectation` instead): coercing absence to 0 would read as "0% Provisioned", a
   *  real and false reading, for a system that has never run an economy cycle. Unlike
   *  `provisionExpectation`, this is a fresh per-cycle reading with no memory semantics — a
   *  corrupt or missing write drops straight to absent rather than keeping the prior cycle's
   *  figure. Written once per economy cycle, alongside `provisionExpectation`. */
  provision?: number;
  /** This cycle's supply band — `foldSupplyState`'s `regime` (lib/engine/population.ts),
   *  carrying the survival punch-through (Shortage, whatever `provision` reads) through
   *  persistence so a famine reading is not re-inferred from the number on the read side. Same
   *  absence convention as `provision`: absent means never assessed, never "supplied". Written
   *  once per economy cycle, alongside `provision`. */
  supplyBand?: SupplyRegime;
  /** This cycle's critical-good override weight — `foldSupplyState`'s `criticalWeight`
   *  (lib/engine/population.ts), the crisis-term input `supplyUnrestTerm` reads whenever
   *  `supplyBand` is not itself "shortage" (the survival branch already carries slopeShortage
   *  outright; this covers the graduated override below it). Not inferable from `supplyBand`: two
   *  systems banded identically can carry very different critical-good weight (`SupplyState`'s own
   *  docstring), so — unlike `survivalShortfall`, which IS a strict biconditional with
   *  `supplyBand === "shortage"` (`foldSupplyState` only ever returns that regime from the
   *  survival branch) — this needs its own field rather than being re-derived from the band. Same
   *  absence convention as `provision`/`supplyBand`: absent means never assessed. Deliberately NOT
   *  clamped to [0, 1] the way `provision` is: `supplyUnrestTerm` only floors it at 0
   *  (`Math.max(0, supply.criticalWeight)`) and its effect is bounded separately by the
   *  `min(slopeShortage, …)` cap inside that function, not by the weight itself — clamping the
   *  stored value to 1 would silently cap a legitimate larger weight at the persistence layer
   *  instead of where the engine already bounds it. Written once per economy cycle, alongside
   *  `provision`/`supplyBand`. */
  criticalWeight?: number;
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
  /** Production-good type id, or a non-production type: "housing", an academy, a specialisation complex, or "construction_centre". */
  buildingType: string;
  /** Whole-integer level count. Grows only via landed construction projects; sheds whole levels via decay. */
  count: number;
  /** Sustained-idle countdown for this (system, type): counts up while ≥1 whole level sits idle, resets on refill, sheds one level at the decay buffer. */
  idleCycles: number;
}

/** Fields every committed construction project shares — funded by `factionId`'s per-cycle pool. */
interface WorldConstructionProjectBase {
  id: string;
  factionId: string;
  systemId: string;
  /** Who committed this row: the autonomic planner, or a player order (priority, display, cancel-permission). */
  origin: "auto" | "player";
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

/** One founding-manifest line: a quantity of one good moving with a colony seed. */
export interface WorldFoundingStockLine {
  goodId: string;
  quantity: number;
}

/**
 * A queued order to establish a colony at controlled `systemId` (docs/active/gameplay/colonisation.md
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
  /**
   * Goods already drawn from the source and paid for, awaiting delivery — real in-transit inventory
   * that is in no market row at either end until the colony opens. Cancellation returns it to the
   * source; completion credits it to the colony.
   */
  stagedManifest: WorldFoundingStockLine[];
  /** The one-off charter fee has been debited. False → the project absorbs no work and stages nothing. */
  charterPaid: boolean;
  /** Consecutive cycles stalled for want of materials or money, counted only once the charter is
   *  paid. A cycle the construction pool never reached does not count. */
  stalledCycles: number;
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
   * Total cycles-of-supply demand denominator: civilian consumption **plus** industrial input draw.
   * This is the pricing anchor (targetStock = TARGET_COVER × demandRate) and the directed-logistics
   * deficit anchor — NOT the civilian-only want the Population panel's needs ledger renders (that is
   * `consumptionRate`, unfloored). Recomputed each economy cycle by the population processor via
   * `totalDemandRateForGood`; seeded civilian-only at world-gen and overwritten with the
   * civilian+industrial total on the first cycle.
   */
  demandRate: number;
  /**
   * What this system's population and industry actually USE of this good per reference cycle:
   * civilian want at full rate plus the local recipe draw, staffing- and strike-gated. Every
   * warehousing quantity — logistics targets, donor floors, consumer/producer classification —
   * is denominated in it, so it must move only as buildings, population and strike state move,
   * never with stock. Distinct from `demandRate` above, which is the floored, capacity-based
   * pricing anchor. Rewritten each economy cycle by the population processor and seeded at
   * market creation. **Missing reads as a live recompute, never 0** — a 0 would make the row an
   * un-sinkable, fully-drawable donor.
   */
  honestUseRate?: number;
  /** Infrastructure storage capacity for this good from the system's built buildings. */
  storageCapacity: number;
  /**
   * Consumption satisfaction the last economy cycle actually applied for this
   * good (civilian delivered ÷ demanded, ∈ [0,1]; 1 = fully served). The
   * measured-once flow the needs display, the planner fed-proxy, and the regime
   * classification all read — never recomputed from stock. Optional:
   * missing (pre-change save) reads as 1.
   */
  satisfaction?: number;
  /** Reference-cycle realized output; missing uses capacity until first assessment. */
  realizedProductionRate?: number;
  /** Strike or maintenance reduced production; event modifiers are deliberately excluded. Missing reads as false. */
  productionSuppressed?: boolean;
  /**
   * The strike × maintenance production scalar the economy applied to this row's SYSTEM this cycle,
   * ∈ (0,1]. Distinct from the `productionSuppressed` bool above, which is a property of the market
   * (false on every good the system has no industry for). Persisted because the draw figure is
   * derived live at read points, away from the strike params and the maintenance malus.
   * Missing reads as 1.
   */
  productionSuppressRate?: number;
  /** Aggregated event production multiplier the economy applied this cycle (caps 0.1–3.0). Missing reads as 1. */
  productionMult?: number;
  /** Reference-cycles a rationed economy assessment has persisted — a finite value in [0,2], advanced
   *  per assessment by the economy interval's catchUpFactor (2 = two reference cycles). Missing reads as 0. */
  squeezeCycles?: number;
  /** Reference-cycles a structural construction assessment has persisted — a finite value in [0,2],
   *  advanced per assessment by the construction interval's catchUpFactor (2 = two reference cycles).
   *  Missing reads as 0. */
  proposalCycles?: number;
  /**
   * The latest logistics assessment found this row at one endpoint of a reachable
   * wanted-but-unfunded match. Source-side: demand-backed export capacity must not
   * be pruned as glut. Destination-side: distinguishes constrained delivery from
   * absent reachable supply. Missing => false.
   */
  logisticsFundingBound?: boolean;
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

// ── Treasury ────────────────────────────────────────────────────

/** One system's contribution to a settlement's income, itemised for the UI and harness. */
export interface TreasuryIncomeBySystem {
  systemId: string;
  heads: number;
  production: number;
}

/** World-facing name for the engine's maintenance line item — one shape, no drift. */
export type TreasuryMaintenanceLine = MaintenanceBillLine;

/** The last cycle settlement's itemised snapshot — persisted so UI reads never recompute transients. */
export interface WorldTreasurySettlement {
  tick: number;
  headsIncome: number;
  productionIncome: number;
  incomeBySystem: TreasuryIncomeBySystem[];
  maintenanceBill: number;
  maintenanceByType: TreasuryMaintenanceLine[];
  logisticsBill: number;
  constructionBill: number;
  paid: TreasuryBands;
  /**
   * Colony charter fees and staged founding materials settled this cycle. Its own field, never a
   * fourth band: `TreasuryBands` is shared by the sliders, the bills and the latched funding
   * fractions, and founding is none of those — it is taken off the top, ahead of the ladder.
   */
  foundingExpense: number;
}

/** One faction's treasury — the only persisted per-faction tick-mutable state. */
export interface WorldFactionTreasury {
  factionId: string;
  /** ≥ 0 — no debt instrument. */
  balance: number;
  taxLevel: TaxLevel;
  /** Funding sliders (0-1); maintenance is floored at 0.5 at every write boundary. */
  bands: TreasuryBands;
  /** Latched paid-fractions from the last settlement — the effective funding each band's consumers run at. */
  funded: TreasuryBands;
  /** Work performed since the last settlement (logistics S-normalised at accrual); billed then cleared. */
  pendingWork: { logistics: number; construction: number };
  /**
   * Founding money committed since the last settlement — charter fees and staged materials, already
   * valued. Accrued by directed build on its own cycle, drained and zeroed at settlement, exactly as
   * `pendingWork` is. Directed build also READS it: `balance − pendingFounding` is the working
   * balance its affordability checks spend against, which is what makes several commitments in one
   * cycle sum correctly.
   */
  pendingFounding: number;
  lastSettlement: WorldTreasurySettlement | null;
  updatedAtTick: number;
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
  treasuries: WorldFactionTreasury[];
  events: WorldEvent[];
  modifiers: WorldEventModifier[];
  ships: WorldShip[];
  /** Rolling window of directed-logistics flow events; pruned to the retention window by the tick body. */
  flowEvents: WorldFlowEvent[];
  /** Monotonic counter for generating unique ids. */
  nextId: number;
}
