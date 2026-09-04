/**
 * World-state types — the hand-owned, in-memory model of the whole game
 * universe. Every field is a plain string/number/
 * boolean/array/object so the whole `World` survives
 * `JSON.parse(JSON.stringify(world))` (save/load round-trips through this).
 *
 * Entities are stored as flat top-level arrays keyed by id (or a natural
 * composite key), not nested — the same normalised shape as the relational
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
import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";
import type { MaintenanceBillLine, TreasuryBands } from "@/lib/engine/treasury";
import type { SupplyRegime } from "@/lib/engine/population";
import type { BuildDropReason } from "@/lib/engine/directed-build";
import type { SystemHabitabilityQuality } from "@/lib/engine/habitability";

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
  automation: { build: boolean; colonisation: boolean; lanes: boolean };
  /**
   * Tick of the player's last successful `claimSystem` order (docs/planned/logistics-lanes.md §1) —
   * absent means never claimed, not tick 0. `claimSystem` refuses a new claim until `currentTick −
   * lastClaimTick ≥ PLAYER_CLAIM_COOLDOWN × CYCLE_LENGTH` (`lib/constants/lanes.ts`,
   * `lib/constants/tick-cadence.ts`). Nothing inside the tick reads this.
   */
  lastClaimTick?: number;
  /**
   * Player-curated bookmark list for the Tracker panel (docs/active/gameplay/tracker.md), insertion-
   * ordered and deduplicated at the write boundary — never re-sorted, never capped. Pinning is a
   * bookmark, not an ownership claim: an id may name a system belonging to another faction. No
   * processor reads this; a pinned id that no longer exists (abandoned back to unclaimed) is filtered
   * on read rather than pruned here, so this list can carry stale ids between reads.
   */
  pinnedSystemIds: string[];
  /**
   * Which alert categories the player wants on the bar (docs/active/gameplay/alert-bar.md →
   * "Settings"). Every attention-layer setting lives in the save, whatever kind of setting it is —
   * a toggle, a pin or an expanded section — so this sits here beside `pinnedSystemIds` rather than
   * in browser storage, and a saved game carries the player's own reading of it. Seeded from
   * `DEFAULT_ALERT_CATEGORIES` at world-gen; every key is always present. A critical category's
   * flag starts `true` and `setAlertCategory` refuses to change it, so the only way this record can
   * carry a hidden critical category is a hand-edited save — which the chip run does not honour
   * either (it short-circuits on the registry's `hideable`). No processor reads this.
   */
  alertCategories: AlertCategorySettings;
  /**
   * Which Tracker sections the player wants rendered (docs/active/gameplay/tracker.md →
   * "Settings"). In the save for the same reason `alertCategories` is. Seeded from
   * `DEFAULT_TRACKER_SECTIONS` at world-gen; all three keys are always present. No processor reads
   * this.
   */
  trackerSections: TrackerSections;
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
   *  carrying the survival punch-through (Famine, whatever `provision` reads) through
   *  persistence so a famine reading is not re-inferred from the number on the read side. Same
   *  absence convention as `provision`: absent means never assessed, never "supplied". Written
   *  once per economy cycle, alongside `provision`. */
  supplyBand?: SupplyRegime;
  /** This cycle's critical-good override weight — `foldSupplyState`'s `criticalWeight`
   *  (lib/engine/population.ts), the crisis-term input `supplyUnrestTerm` reads whenever
   *  `supplyBand` is not itself "famine" (the survival branch already carries slopeShortage
   *  outright; this covers the graduated override below it). Not inferable from `supplyBand`: two
   *  systems banded identically can carry very different critical-good weight (`SupplyState`'s own
   *  docstring), so — unlike `survivalShortfall`, which IS a strict biconditional with
   *  `supplyBand === "famine"` (`foldSupplyState` only ever returns that regime from the
   *  survival branch) — this needs its own field rather than being re-derived from the band. Same
   *  absence convention as `provision`/`supplyBand`: absent means never assessed. Deliberately NOT
   *  clamped to [0, 1] the way `provision` is: `supplyUnrestTerm` only floors it at 0
   *  (`Math.max(0, supply.criticalWeight)`) and its effect is bounded separately by the
   *  `min(slopeShortage, …)` cap inside that function, not by the weight itself — clamping the
   *  stored value to 1 would silently cap a legitimate larger weight at the persistence layer
   *  instead of where the engine already bounds it. Written once per economy cycle, alongside
   *  `provision`/`supplyBand`. */
  criticalWeight?: number;
  /** The realised change in `population` across one economy cycle, including both migration and
   *  colony-founding transfers — `population_after_this_cycle's_transfers − population_at_cycle_start`,
   *  denominated per reference cycle (dividing the realised change by this cycle's own
   *  `catchUpFactor`, mirroring `populationDelta`'s own denomination in lib/engine/population.ts
   *  rather than the scaled figure a single run actually applies) so the reading is unchanged if
   *  `CYCLE_LENGTH` is retuned away from `REFERENCE_INTERVAL`. Written by the tick body
   *  (`lib/world/tick.ts`), AFTER the directed-build stage — not by the population processor:
   *  `populationDelta` (lib/engine/population.ts) carries no migration term, and on a dying colony
   *  chosen as a founding donor the colony-seed debit is often the dominant drain, so persisting
   *  the migration-inclusive-but-pre-founding figure would still systematically understate the
   *  collapse. A donor therefore reads more pessimistic for the single cycle it founds a colony,
   *  self-correcting the next — accepted, because the field means realised change and erring toward
   *  warning beats erring toward reassurance. Same absence convention as `provision`/`supplyBand`/
   *  `criticalWeight` above: absent means never assessed, written for every system the population
   *  processor visited this cycle (0 included, distinct from absent), untouched for one it did not,
   *  and cleared — not carried forward — on abandonment or redevelopment (`applyAbandonments`,
   *  `applyDevelopments`, both `lib/world/tick.ts`) so a re-founded colony never inherits its
   *  predecessor's reading. Authored for one job — the Population collapse alert sorts by time to
   *  abandonment, and this is the decay rate that countdown extrapolates from; a reader wanting a
   *  different shape (a trailing average, a longer window) adds its own field rather than redefining
   *  this one, which is exactly what `populationTrend` below is. Signed: negative means shrinking,
   *  positive means growing — `populationTrend` carries the same polarity deliberately.
   *  Nothing inside the tick reads it. */
  populationChange?: number;
  /** A smoothed, founding-excluded reading of whether a world is dying — an exponential moving
   *  average (half-life ~3 reference cycles; `alpha = 1 − 2^(−1/3)`, derived from that half-life
   *  rather than authored as a bare literal) over the FRACTIONAL population change per reference
   *  cycle, EXCLUDING colony-founding transfers: `(delta_excluding_founding) / catchUpFactor) /
   *  population_at_cycle_start` — denominated per reference cycle exactly like `populationChange`
   *  (dividing by this cycle's own `catchUpFactor`), so the reading is unchanged if `CYCLE_LENGTH`
   *  is retuned away from `REFERENCE_INTERVAL`, same as that field. `populationChange` deliberately includes the founding debit
   *  because its job is realised change; this field's job is different — a donor handing settlers
   *  to a colony on purpose is not dying, so the founding debit is added back out of the sample
   *  before it feeds the average. Migration stays IN the sample: people leaving because a world is
   *  bad is exactly what this field exists to catch. Without the exclusion, founding-era play (where
   *  a 20-pop donor giving up `EXPANSION.COLONY_SEED_POP`, 2, reads as a 10% one-cycle drop) would
   *  trip a decline-rate alert for several cycles on a donor that isn't declining at all.
   *
   *  SIGNED, same polarity as `populationChange` right beside it: negative means the world is
   *  shrinking, positive means it is growing. A reader that wants "how fast is this world dying"
   *  compares against a NEGATIVE bound (`trend <= -threshold`), never a positive one — the sign is
   *  the whole gate, not a detail to get right incidentally.
   *
   *  Stored as a fraction (not absolute), so it reads directly as a rate and stays scale-free across
   *  world sizes; guarded against population <= 0 at the write site rather than ever storing a
   *  non-finite value (`World` must stay JSON-serialisable). Seeded from the first sample rather
   *  than 0, so a newly assessed world doesn't read as "not declining" before it has one. Written by
   *  the tick body (`lib/world/tick.ts`), alongside `populationChange`, AFTER the directed-build
   *  stage — same reason `populationChange` is. Same absence convention as `populationChange`:
   *  absent means never assessed, written for every system the population processor visited this
   *  cycle, untouched for one it did not, and cleared — not carried forward — on abandonment or
   *  redevelopment (`applyAbandonments`, `applyDevelopments`, both `lib/world/tick.ts`) so a
   *  re-founded colony never inherits its predecessor's reading.
   *
   *  Authored for one job — gating entry into the alert bar's Population collapse category (a
   *  well-fed, unrest-driven decline that `populationChange`'s per-cycle countdown alone would never
   *  catch, since that countdown is only computed for famine systems). Nothing inside the tick reads
   *  it. */
  populationTrend?: number;
  /** This run's best-ranked dropped production opportunity from the directed-build planner — the
   *  alert bar's Build blocked category. See `BuildDropReport` (`lib/engine/directed-build.ts`) for
   *  the reasons and for what `droppedRoi` is (and is not) at each drop site. Written directly by
   *  the directed-build processor's world adapter
   *  (`applyBuildBlockedUpdates`, `lib/tick/world/directed-build-world.ts`), applied in
   *  `lib/world/tick.ts` — not by the generic per-system row-mutation path. Same absence convention
   *  as `provision`/`supplyBand`/`criticalWeight`/`populationChange` above: absent means never
   *  assessed, written for every system the directed-build planner visited this run that had
   *  something dropped, absent for one that landed everything or wanted nothing, untouched for one
   *  the planner did not visit this run (its faction was not due), and cleared — not carried
   *  forward — on abandonment or redevelopment (`applyAbandonments`, `applyDevelopments`, both
   *  `lib/world/tick.ts`) so a re-founded colony never inherits its predecessor's reading. Housing
   *  refusals never appear here — they are *No housing headroom*'s signal, not this one. Nothing
   *  inside the tick reads it. */
  buildBlocked?: { reason: BuildDropReason; droppedRoi: number };
  /** This run's best-ranked SCORED production opportunity from the directed-build planner — the alert
   *  bar's Build opportunity category. `score` is `BuildOpportunity.score` verbatim (Ordering only,
   *  not comparable between systems); `goodId` is the good it would serve, carried along because the
   *  read service bands the category on it against `SURVIVAL_GOODS` — a system with any
   *  survival-serving opportunity is represented by that one rather than its highest-scoring one; see
   *  `BuildOpportunityReport` (`lib/engine/directed-build.ts`) for the full selection rule. Written
   *  directly by the directed-build processor's world adapter (`applyBuildOpportunityUpdates`,
   *  `lib/tick/world/directed-build-world.ts`), applied in `lib/world/tick.ts` — not by the generic
   *  per-system row-mutation path. Same absence convention as `buildBlocked` above: absent means never
   *  scored, written for every system the directed-build planner visited this run that scored
   *  anything, absent for one that scored nothing, untouched for one the planner did not visit this
   *  run, and cleared — not carried forward — on abandonment or redevelopment. Nothing inside the tick
   *  reads it. */
  buildOpportunity?: { score: number; goodId: string };
  /** This run's best-ranked colony-establish terms from the directed-build planner — the alert bar's
   *  Colony opportunity category. `value` is `colonyValue(c, …) − popCost` (the ROI numerator) and
   *  `work` the establish-plus-housing denominator — the same terms `ColonyProposal` carries
   *  (`lib/engine/directed-build.ts`). Written directly by the directed-build processor's world
   *  adapter (`applyColonyOpportunityUpdates`, `lib/tick/world/directed-build-world.ts`), applied in
   *  `lib/world/tick.ts` — not by the generic per-system row-mutation path. Absent means never
   *  assessed as worth it: written for every CANDIDATE (a controlled, not-yet-developed system) the
   *  colonisation planner's PRE-GATE assessment kept this run (`assessColonyCandidates`), absent for
   *  one it considered and dropped (below the habitable floor, already in flight, net-negative
   *  value). The money/settler-supply gates truncate only what gets FOUNDED, never this field — a
   *  site the faction cannot yet afford keeps its reading. Untouched for a candidate the planner did
   *  not consider this run
   *  (its faction was not due, or the `develop` param was absent), and cleared — not carried forward —
   *  on abandonment or redevelopment so a founded colony never inherits its own candidacy reading.
   *  Nothing inside the tick reads it. */
  colonyOpportunity?: { value: number; work: number };
  /**
   * Cached fill-best-first habitability quality (`systemHabitabilityQuality`,
   * `lib/engine/habitability.ts`) — the people-land-weighted mean score over the prefix this
   * system's population currently occupies, best-body-first. Written by the population
   * processor's world adapter through the generic per-system row-mutation path (unlike
   * `buildBlocked`/`buildOpportunity`/`colonyOpportunity` above, which bypass it). Recomputed only
   * when the occupied prefix crosses a body boundary (`frontierIndex` changing) — population
   * movement within the same body leaves this field's value untouched, so most systems (one
   * contributing body) write it once and never again. Absent means the population processor has
   * never assessed this system (a frontier/controlled system it hasn't visited, or a pre-change
   * save); cleared — not carried forward — on abandonment or redevelopment
   * (`applyAbandonments`/`applyDevelopments`, both `lib/world/tick.ts`) so a re-founded colony
   * never inherits its predecessor's reading. Read by `populationDelta`'s growth term (the
   * population processor).
   */
  habitabilityQuality?: SystemHabitabilityQuality;
  /** Sum of body-archetype danger baselines. */
  bodyDanger: number;
  /** The people-land budget housing bills against — Σ per-body authored peopleLand over above-threshold, unlocked bodies. */
  peopleLand: number;
  /** Extractor-slot caps, one per resource — Σ authored deposit counts over unlocked bodies. */
  countGas: number;
  countMinerals: number;
  countOre: number;
  countBiomass: number;
  countArable: number;
  countWater: number;
  countRadioactive: number;
  /**
   * Effective quality multipliers, one per resource — `realised / eff*`, so `yield* × eff*` is
   * exactly the mean ground value over the worked deposit prefix (`lib/engine/worked-deposits.ts`).
   *
   * A maintained CACHE of (this system's bodies × its tier-0 extractor counts), not fixed
   * substrate: written at generation, refolded by the tick at each count change (a landed build, a
   * decay shed, an abandonment wipe — `refoldWorkedYields`, `lib/world/tick.ts`) and rebuilt on
   * load. The all-bodies
   * POTENTIAL pool the economy-type label reads is a separate derivation
   * (`substrateAggregates`' `potentialYieldMult`, `lib/engine/body-gen.ts`), never this column.
   */
  yieldGas: number;
  yieldMinerals: number;
  yieldOre: number;
  yieldBiomass: number;
  yieldArable: number;
  yieldWater: number;
  yieldRadioactive: number;
  /** Effective per-resource extraction-work efficiency — the WORKED-PREFIX mean of the contributing
   *  bodies' `extractionModifier` (1.0 where the system has no deposits of that resource at all).
   *  Kept as its OWN aggregate, never folded into yield*; same cache/write contract as yield*
   *  above. Not monotone under a future body unlock on its own — only the product is. */
  effGas: number;
  effMinerals: number;
  effOre: number;
  effBiomass: number;
  effArable: number;
  effWater: number;
  effRadioactive: number;
}

// ── Bodies ──────────────────────────────────────────────────────

export interface WorldBody {
  id: string;
  systemId: string;
  bodyType: BodyArchetypeId;
  /** Display flavour only — carries no budget meaning. */
  size: number;
  /** This body's authored people-land budget (dark land when below threshold or locked). */
  peopleLand: number;
  /** Per-body slot counts, one per resource (0 = no deposit). */
  countGas: number;
  countMinerals: number;
  countOre: number;
  countBiomass: number;
  countArable: number;
  countWater: number;
  countRadioactive: number;
  /** Per-body quality multipliers, one per resource (0 = no deposit). */
  qualGas: number;
  qualMinerals: number;
  qualOre: number;
  qualBiomass: number;
  qualArable: number;
  qualWater: number;
  qualRadioactive: number;
  /**
   * This body's ring, 1..n over the system's bodies (ring 1 innermost) — cosmetic only, read by
   * nothing inside the tick, only the system-view ring drawing. Additive and optional: an old save
   * loads without it, and a body with none is drawn in array order (`docs/active/gameplay/system-view.md`).
   */
  orbitIndex?: number;
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
  /** Who committed this row: the autonomic planner, or a player order (priority, display, cancel-permission). */
  origin: "auto" | "player";
  /** Total construction work to complete. */
  workTotal: number;
  /** Construction points accumulated so far, in [0, workTotal]. */
  workDone: number;
}

/**
 * A queued order to build `levels` whole levels of `buildingType` at `systemId`. Levels land
 * incrementally as work accrues: each time `workDone` crosses a `workTotal ÷ levels` boundary, the
 * funding step lands that level immediately (a real building-count increase) and this row's own
 * `levels`/`workTotal`/`workDone` shrink to the remaining, still-open levels — so a project's stored
 * row always describes only what has NOT yet landed. Duration is emergent (work ÷ funded points),
 * never a stored timer.
 */
export interface WorldBuildProject extends WorldConstructionProjectBase {
  kind: "build";
  systemId: string;
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
  systemId: string;
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
 * A queued order to raise the undirected lane `laneKey` (`lib/engine/lanes.ts`) by `levels` whole
 * levels. Unlike `WorldBuildProject`/`WorldColonyEstablishProject`, this row is not scoped to a single
 * `systemId` — it carries its undirected lane key instead, and is dropped rather than reassigned when
 * either endpoint stops satisfying investability (`dropAbandonedBuildProjects`, `lib/world/tick.ts`).
 * Levels land incrementally exactly as a `kind: "build"` row's do: `fundQueueWithFloor` reads only
 * `levels`/`workTotal`/`workDone`, so the same `workTotal ÷ levels` boundary landing applies here too
 * (`splitLandedLevels`, `lib/engine/construction.ts`), crediting whole levels onto `WorldLane.level`
 * via `applyLaneLevelIncreases`.
 */
export interface WorldLaneUpgradeProject extends WorldConstructionProjectBase {
  kind: "lane_upgrade";
  laneKey: string;
  /** Whole levels this project lands on completion (integer ≥ 1). */
  levels: number;
}

/**
 * One committed construction project. A discriminated union: ordinary `build` levels, a
 * `colony_establish` that lands a viable colony, or a `lane_upgrade` that raises an undirected lane's
 * invested level. All three are funded from the same per-faction throughput pool by the same
 * `fundQueue`, so build-vs-colonise-vs-lane arbitrates on one budget.
 */
export type WorldConstructionProject = WorldBuildProject | WorldColonyEstablishProject | WorldLaneUpgradeProject;

export interface WorldConnection {
  fromId: string;
  toId: string;
  fuelCost: number;
}

/**
 * A persistent, undirected jump lane — one row per system pair that carries a `WorldConnection`
 * (docs/planned/logistics-lanes.md §1). `aId < bId`, and `key` is exactly `${aId}|${bId}` — the same
 * sorted-pair key `buildOpenEdges` dedupes reciprocal connection rows on
 * (`lib/tick/world/trade-flow-topology.ts`) — so a lane and its open-edge view always agree on
 * identity.
 *
 * `level` is the invested upgrade tier (float, ≥ 0; capacity rises with it, `laneCapacity` in
 * `lib/engine/lanes.ts`) — level 0 is a lane nobody has invested in, not an impassable one: every
 * generated lane carries a small baseline capacity with no investment (§1). `bookedLoad` is a
 * per-run quota the logistics processor writes and resets each logistics run; `blockedVolume` is the
 * volume a saturated edge turned away the same run; both read 0 until a logistics run has visited the
 * lane. Booked + blocked is the "attempted load" figure lane decay reads. `idleCycles` is the lane
 * analogue of `WorldBuilding.idleCycles`: a sustained-idle counter (the lane decay dead band, §1)
 * that only advances while a whole level's capacity goes unused and resets on any run that uses it;
 * it reads 0 until decay assessment runs against the lane.
 */
export interface WorldLane {
  key: string;
  aId: string;
  bId: string;
  level: number;
  bookedLoad: number;
  blockedVolume: number;
  idleCycles: number;
}

/**
 * One scheduled-freight ledger row (docs/planned/logistics-lanes.md §3) — written at dispatch by
 * directed-logistics (a future pass; nothing dispatches onto this ledger yet), drained by the
 * unconditional per-tick goods-arrivals stage. `routeEdges` is the ordered `laneKey` (`lib/engine/
 * lanes.ts`) list the haul crosses — the interdiction query's substrate.
 *
 * `leg: "outbound"` is a donor→destination haul in flight; the destination's band cap
 * (`marketBandForRow(...).maxStock`) applies at arrival, and any uncredited remainder is returned
 * to the donor as a fresh `leg: "return"` row over the reversed `routeEdges`, arriving after the
 * SAME delay (`arrivalTick − dispatchTick`) the outbound leg took. A return leg credits its target
 * (the original donor) in full, uncapped — the cancelled-colony precedent (staged materials return
 * uncapped, docs/active/gameplay/player-seat.md Cancel) — and is deliberately excluded from
 * `scheduledInbound` (`lib/engine/freight.ts`): it is goods heading back to a donor, not inbound
 * supply a destination should stop ordering against.
 */
export interface WorldPendingArrival {
  id: string;
  /** The hauling faction, or null for the independent (null-faction) group — matches
   *  `SystemLogisticsRow.factionId`. */
  factionId: string | null;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
  dispatchTick: number;
  arrivalTick: number;
  routeEdges: string[];
  leg: "outbound" | "return";
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
  /** Reference-cycle realised output; missing uses capacity until first assessment. */
  realisedProductionRate?: number;
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
  /**
   * The realised change in `stock` across one full economy cycle — the whole window between this
   * boundary tick and the previous one, not just this tick's own delta — production minus
   * consumption, net of imports/exports and of what a founding donor shipped out to stand up a
   * colony, denominated per reference cycle (dividing the realised change by this cycle's own
   * `catchUpFactor`, the same denomination `WorldSystem.populationChange` uses) so the reading is
   * unchanged if `CYCLE_LENGTH` is retuned. Written ONLY for `SURVIVAL_GOODS`
   * (lib/constants/physical-economy.ts:153 — water and food); every other good's market row never
   * carries this key, present or absent.
   *
   * Written by the tick body (lib/world/tick.ts) against the persisted baseline
   * `stockAtLastBoundary` below, on the boundary tick, after the last stage of that tick that moves
   * `stock` — directed build's founding staging draw and staged manifest delivery, which run after
   * directed logistics' own stock updates and after the per-tick goods-arrivals stage that can
   * credit a haul on ANY tick of the cycle, not only this boundary one. Comparing against the
   * baseline (rather than a snapshot taken at this tick's own start) is what makes a haul that
   * landed earlier in the cycle show up here at all. A founding donor's draw is a real loss from its
   * warehouse, and this figure's one reader divides `stock` by `−stockChange` for a cycles-to-empty
   * countdown, so leaving the draw out would report a longer runway than the donor has. Same absence
   * convention as `logisticsFundingBound` above: absent means never assessed — written for every
   * survival-good market row belonging to a system that is developed as of this boundary tick AND
   * already carries a baseline from the previous one (0 included, distinct from absent); a row with
   * no baseline yet (a fresh market row, or one an abandonment just cleared) writes no `stockChange`
   * this boundary, only a baseline to diff against next time. Untouched for a market row the tick
   * did not visit, and cleared — not carried forward — on abandonment (`resetAbandonedMarkets`,
   * lib/world/tick.ts) so a resettled colony's warehouse does not inherit its predecessor's drain
   * rate. `stock` itself is deliberately left untouched by that same reset — the warehouse is real.
   *
   * Authored for one job — the Survival stock falling alert's `stock / −stockChange` cycles-to-empty
   * measure. Nothing inside the tick reads it.
   */
  stockChange?: number;
  /**
   * The `stock` this row carried at the end of the previous economy-cycle boundary tick — the
   * baseline `stockChange` above diffs against, rather than a value snapshotted at the current
   * tick's own start. Written and rewritten in lockstep with `stockChange`: on every boundary tick,
   * for every survival-good row of a system developed as of that tick, this is set to the row's
   * current `stock` regardless of whether a `stockChange` was written alongside it. Absent means
   * this row has never stood at a boundary since it was created (or since abandonment last cleared
   * it) — the same "absent, not zero" convention `stockChange` uses, and the reason the FIRST
   * boundary a row is visited writes a baseline but no `stockChange`. Cleared alongside
   * `stockChange` on abandonment (`resetAbandonedMarkets`, lib/world/tick.ts) for the same reason:
   * a re-founded colony's drain rate starts over, not from where its predecessor's warehouse stood.
   * Nothing outside this one computation reads it.
   */
  stockAtLastBoundary?: number;
  /**
   * How much of this row's demand no reachable same-faction donor and no local production could close
   * on the latest directed-logistics run — the deficit's `max(0, target − stock)` LESS the drawable
   * capacity its reachable donors still held (`UnservableDeficit.shortfall`,
   * `lib/engine/directed-logistics.ts`), for a deficit whose remaining gap is STRUCTURAL, not a
   * matter of this cycle's haul budget. The part a donor did cover is not in here. A LEVEL, not a
   * rate: unlike `stockChange` it carries no per-cycle denomination, so retuning `CYCLE_LENGTH` does
   * not move it.
   *
   * **The size IS the classification.** A structurally-unservable deficit always has a strictly
   * positive level — the engine only queues a deficit at all when `shortfall > 0`
   * (`lib/engine/directed-logistics.ts`, the deficit classification's own guard) and only records
   * one here when reachable capacity falls strictly short of that — so it carries no separate "is
   * unservable" bit that could drift out of step with the number. A row reading absent, or reading
   * 0, is servable.
   *
   * Written by the directed-logistics ENGINE (`matchFactionTransfers`'s `unservable` result),
   * threaded out through the processor (`lib/tick/processors/directed-logistics.ts`) exactly as
   * `logisticsFundingBound` is.
   *
   * Deliberately unlike `logisticsFundingBound`, which the matcher writes to BOTH endpoints of a
   * funding-bound haul (including the donor): this is written on the DEFICIT endpoint only. A donor
   * carries no reading about its own local demand being unservable — that would put an exporting
   * system in a category about unmet local demand, which is not what a donor is.
   *
   * Distinct from, and not exclusive with, `logisticsFundingBound`: that field means "the WORK
   * BUDGET stopped a fill that had enough reachable capacity to succeed" — served next run with no
   * change to the world. This field means "the shortfall would persist even with unlimited budget,
   * because reachable donors and local production together cannot supply it" — the world itself
   * would have to change (new capacity, a new route, a fresh donor). A deficit can carry both at
   * once: reachable capacity can be jointly too small AND the budget can also run out before
   * reaching even that insufficient capacity. See the engine type's own docstring for the exact test.
   *
   * Same conventions as `logisticsFundingBound` above — and note that is the closer of the two
   * precedents: every deficit row the run visits is assessed, but the key is written only where the
   * reading CHANGES, so a never-structural deficit stays absent rather than becoming a present 0.
   * (`stockChange` differs — it writes unconditionally every visit.) A deficit that gains a donor or
   * a local producer therefore has this key DELETED on the next run, a row the run did not visit is
   * untouched, and it refreshes whenever the level moves — a shortfall that widens or narrows while
   * the market stays structurally unservable never goes stale. Cleared (deleted,
   * `resetAbandonedMarkets`) on abandonment so a resettled colony does not inherit its predecessor's
   * structural reading: that reading named a shortfall the PREVIOUS colony's donors and production
   * could not close, and a fresh one has neither yet. Authored for one job — the Demand unservable
   * alert and its within-category sort (largest shortfall first). Nothing inside the tick reads it
   * back.
   */
  unservedShortfall?: number;
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
   * What each band was ASKED to pay at this settlement — `bill × the slider in force at that
   * instant` (`settleLadder`'s own `charge`, after its clamp). Frozen alongside `paid`, and that
   * pairing is the point: a band is insolvent exactly when `paid[band] < charged[band]`, and the
   * sliders are live player policy the player can move at any moment with no re-settle. Comparing a
   * frozen `paid` against today's slider reports insolvency for moving the slider — which is the
   * corrective action — and hides it for moving the slider the other way. Every reading of "this
   * settlement could not pay what it was asked for" therefore takes both terms from this one row;
   * `bandShortfall` (`lib/engine/treasury.ts`) is the single place that does it.
   *
   * All three bands rather than only the one a category reads today: it is the same `TreasuryBands`
   * shape as `paid` beside it, and a per-band charge is exactly what that type is for. Optional so a
   * save written before the field existed loads without it; absent reads as never-assessed (readers
   * skip rather than guess), and the faction's next settlement fills it in.
   */
  charged?: TreasuryBands;
  /**
   * Colony charter fees and staged founding materials settled this cycle. Its own field, never a
   * fourth band: `TreasuryBands` is shared by the sliders, the bills and the latched funding
   * fractions, and founding is none of those — it is taken off the top, ahead of the ladder.
   */
  foundingExpense: number;
  /**
   * Lane upkeep folded into `maintenanceBill` this cycle (docs/planned/logistics-lanes.md §1: "build
   * and upkeep ride the existing purse") — `laneUpkeepWork` priced at `maintenanceRatePerWork ×
   * catchUp`, the same band, same rate, same ladder line as building upkeep; broken out here only so
   * a reader can see how much of the one maintenance bill came from lanes. Optional so a save written
   * before this field existed loads without it; absent reads as never-assessed, exactly like
   * `charged` above.
   */
  laneUpkeepBill?: number;
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
  /** Only populated for relations-spawned events. */
  metadata: WorldEventMetadata | null;
}

export interface WorldEventModifier {
  eventId: string;
  /** "economy" today; open-ended for future layers (war, reputation). */
  domain: string;
  /** "anchor_shift", "rate_multiplier". */
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
  /** One persistent row per undirected system pair carrying a connection — see `WorldLane`. */
  lanes: WorldLane[];
  /** The scheduled-freight ledger — see `WorldPendingArrival`. Directed-logistics dispatch appends
   *  a row per outbound transfer; the unconditional goods-arrivals stage drains it every tick,
   *  removing rows that have arrived and writing back whatever is still in flight. */
  pendingArrivals: WorldPendingArrival[];
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
