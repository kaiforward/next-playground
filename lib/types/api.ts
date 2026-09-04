import type { StarSystemInfo, SunClass, GoodTier, BodyArchetypeId, ResourceVector } from "./game";
import type { SubstrateGoodRate, ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import type { SupplyRegime } from "@/lib/engine/population";
import type { FillOrderRow, PotentialYieldRowView } from "@/lib/utils/substrate";

export interface TradeFlowEdgeInfo {
  /** Net source system for the dominant good (where particles spawn). */
  fromSystemId: string;
  /** Net destination system for the dominant good (where particles terminate). */
  toSystemId: string;
  /** Sum of magnitudes across both directions and all goods. */
  totalVolume: number;
  dominantGoodId: string;
  /** Per-good magnitude (both directions summed). */
  perGood: Record<string, number>;
}
/** The directed-logistics overlay edge set the map renders. */
export interface TradeFlowEdges {
  logisticsEdges: TradeFlowEdgeInfo[];
}
/** Aggregate trading partner for a single good (top-N source or destination). */
export interface TradeFlowPartner {
  systemId: string;
  systemName: string;
  quantity: number;
}
/** One bucket of the import/export volume sparkline. `tick` is the bucket end. */
export interface TradeFlowVolumeBucket {
  tick: number;
  importVolume: number;
  exportVolume: number;
}
// ── System logistics (production/consumption + imports/exports dashboard) ─────
/**
 * One good's full logistics row: internal prod/con + external flow split + partners.
 * All rates are PER ECONOMY CYCLE: production/consumption are per-cycle directly;
 * imports/exports (and partner quantities) are the flow-window sum normalised to a
 * per-cycle rate, so the Internal and External columns share units.
 */
export interface LogisticsGoodRow {
  goodId: string;
  goodName: string;
  tier: GoodTier;
  /** Staffed production capacity scaled by the strike/maintenance suppression the economy
   *  applied — the operating rate, on the same basis as `inputDemand`. */
  production: number;
  /** Civilian consumption (per-capita baseline + skilled baskets). Not strike-gated: pops eat. */
  consumption: number;
  /** Manufacturing input demand — recipe draw from local factories at their operating rate
   *  (strike-gated, same basis as `production`). Also local consumption. */
  inputDemand: number;
  /** production − (consumption + inputDemand). */
  internalNet: number;
  importLogistics: number;
  exportLogistics: number;
  /** (exports total) − (imports total), per cycle. */
  externalNet: number;
  /** Any of the four flow totals > 0. */
  traded: boolean;
  /** Top source systems feeding imports of this good. */
  importPartners: TradeFlowPartner[];
  /** Top destination systems receiving exports of this good. */
  exportPartners: TradeFlowPartner[];
}
export type SystemLogisticsData =
  | {
      visibility: "visible";
      /** Tier-ascending, net-descending-within-tier; one entry per good with activity. */
      rows: LogisticsGoodRow[];
      /** Largest single production/consumption rate across rows (internal bar scale). */
      internalMax: number;
      /** Largest single per-cycle import/export rate across rows (external bar scale). */
      externalMax: number;
      /** Goods with production or consumption activity. */
      activeGoodCount: number;
      /** Goods with any cross-border flow. */
      tradedGoodCount: number;
      volumeHistory: TradeFlowVolumeBucket[];
    }
  | { visibility: "unknown" };

// ── System cadence (header "next update" countdown) ──────────────────────────
/**
 * The system's single "next update" cadence group for the header countdown.
 * Under the cycle resolution the whole galaxy resolves together on
 * `tick % CYCLE_LENGTH === 0`, so this is uniformly 0; the value never changes
 * for a given universe, so the client fetches once (staleTime Infinity) and
 * counts down off the live tick.
 */
export interface SystemCadence {
  /** Group in [0, CYCLE_LENGTH): when the whole galaxy resolves. Always 0 under the cycle resolution; kept so the client counts down with ticksUntilShard(resolutionGroup, tick, CYCLE_LENGTH). */
  resolutionGroup: number;
}

/** Full system detail — discriminated union on visibility. */
export type SystemDetailData =
  | (StarSystemInfo & {
      visibility: "visible";
      station: { id: string; name: string } | null;
    })
  | {
      id: string;
      name: string;
      economyType: StarSystemInfo["economyType"];
      regionId: string;
      isGateway: boolean;
      visibility: "unknown";
    };

// ── System population ────────────────────────────────────────────
/** One good's pop-needs snapshot — how well the population's want for it is met. */
export interface PopNeedData {
  goodId: string;
  goodName: string;
  /** Civilian want — unfloored consumption rate (units/cyc), NOT the MIN_DEMAND-floored pricing figure. */
  want: number;
  /** want × satisfaction — what's actually delivered (units/cyc). */
  delivered: number;
  /** delivered ÷ want, in [0,1] — the consume gate at current stock; 1 = fully met. */
  satisfaction: number;
  /** necessity-weighted demandShare × (1 − satisfaction) — this good's contribution to the system's unrest. */
  pressure: number;
  /** want's composition — base + technicians + engineers. */
  breakdown: ConsumptionBreakdown;
}

/**
 * Provisioned + its band + the population's remembered level, shared between `SystemPopulationData`
 * and `SystemVitalsData`. Resolved through the exact functions the tick uses (`readExpectation`,
 * both `lib/engine/`) so the panel and the sim cannot disagree. `WorldSystem.provision`/`.supplyBand`
 * are independently optional and absent means never assessed, never zero — the `assessed: false` arm
 * carries that absence rather than inventing a reading; it is also what a PARTIALLY-written system
 * (one of the pair present, the other absent) renders as, since a half-written assessment is not a
 * real one. `pct`/`expectationPct` are 0..100 (matching `SystemVitalsStability.pct`).
 *
 * The grievance the resolver derives from these two is deliberately NOT here: it is an input to the
 * unrest floor's goods term, and the client is shown that effect (`SystemUnrestRead.contributors`),
 * never the intermediate. It stays on the server-side `ResolvedProvision`
 * (`lib/services/provision-read.ts`).
 */
export type SystemProvisionRead =
  | { assessed: true; pct: number; band: SupplyRegime; expectationPct: number }
  | { assessed: false };

/**
 * The unrest floor's three-way breakdown (goods shortfall, tax, crowding) plus the trend it is
 * heading — so the Stability block can answer "why is this world angry" instead of showing one
 * opaque number. `contributors` are `unrestContributors`'s output (`lib/engine/unrest-readout.ts`)
 * — resolved so they sum to exactly the settled value the tick's own relaxation targets for this
 * system, never an estimate that can drift from the effect. `trend` is `unrestTrend(unrest,
 * settled)` — where `settled` is that same contributor sum — comparing where unrest stands now
 * against where it is heading, with no stored history required. No separate "unassessed" arm the
 * way `SystemProvisionRead` has: a system the economy has not yet classified reads the same
 * zero-shortfall defaults the population processor itself falls back to for an unclassified system
 * (`lib/tick/processors/population.ts`), which is an honest "no shortfall recorded yet", not a
 * fabricated reading.
 */
export type SystemUnrestRead =
  | {
      assessed: true;
      /** The three causes, uncapped — they are the relative sizes of what is driving unrest, and
       *  flattening them at the ceiling would hide which one dominates. */
      contributors: { goods: number; tax: number; crowding: number };
      /** Where unrest is heading: `min(1, goods + tax + crowding)`, the fixed point
       *  `accumulateUnrest` relaxes toward (`UnrestParams`, lib/engine/population.ts). The cap is
       *  load-bearing rather than cosmetic — `slopeShortage` is 2.4, so a famine world's goods term
       *  alone clears 1 at a shortfall of ~0.42 while unrest itself is clamped to 1. Summing raw
       *  would report a world pinned at maximum unrest as still rising, forever, on exactly the
       *  worlds this panel most needs to read correctly. */
      settled: number;
      trend: "rising" | "stable" | "recovering";
      /** STRIKE_PARAMS.threshold — carried alongside so the panel's strike caption and the badge
       *  that names Strike can never disagree on the number. */
      strikeThreshold: number;
    }
  | {
      /** The economy has not assessed this system yet, so the goods cause is unknown — not zero.
       *  Fires for every system before its first economy cycle, which is a routine state (a freshly
       *  founded colony), not a defensive one. Deliberately NOT the population processor's own
       *  "unclassified" fallback, which its comment documents as unreachable in real play and which
       *  guards a different case entirely: an intra-cycle signal inconsistency the economy processor
       *  cannot actually produce. Reusing that fallback's defaults here would render a confident
       *  "no goods problem" bar for a world nobody has measured. */
      assessed: false;
      /** Standing pressure is knowable without an economy assessment — tax comes from the owning
       *  faction's level and crowding from occupancy — so it is carried rather than withheld. There
       *  is no `settled` or `trend`: both need the goods term, and inventing one from these two
       *  alone would describe a world as calm or worsening on a third of the evidence. */
      contributors: { tax: number; crowding: number };
      strikeThreshold: number;
    };

/** Dynamic population & social state for one system — discriminated on visibility. */
export type SystemPopulationData =
  | {
      visibility: "visible";
      population: number;
      popCap: number;
      unrest: number;
      /** True when unrest > STRIKE_PARAMS.threshold — the engine's own strict comparison. */
      striking: boolean;
      /** Pop needs, pressure-sorted descending — the goods the population consumes and how met each want is. */
      needs: PopNeedData[];
      /** Provisioned, its band and the remembered level — see `SystemProvisionRead`. */
      provision: SystemProvisionRead;
      /** The unrest floor's contributor breakdown and trend — see `SystemUnrestRead`. */
      unrestBreakdown: SystemUnrestRead;
      /** The fill-best-first habitability quality (`lib/engine/habitability.ts`) as it multiplies
       *  the growth term (`populationDelta`'s `quality` parameter), resolved through the SAME
       *  shared three-tier contract every consumer shares (`resolveEffectiveHabitabilityQuality`):
       *  the persisted fold-site cache if present; else a fresh compute over this system's
       *  contributing bodies at its current population (a just-founded or just-crossed colony's
       *  first read, before the tick has cached one); 1 (neutral) only when there is no
       *  contributing body to fold over at all — matching the population processor's own fallback
       *  (`lib/tick/processors/population.ts`'s `growthQuality`). `lib/services/universe.ts`'s
       *  `getSystemSubstrate` resolves its occupied-body badges through the same function, so the
       *  two panels can never disagree. */
      growthMultiplier: number;
      /** Every people-land-contributing body in fill-best-first order, decomposing
       *  `growthMultiplier` into the bodies it comes from (spec §3: quality is always a story about
       *  bodies, never a bare number) — see `habitabilityFillOrder`. */
      fillOrder: FillOrderRow[];
    }
  | { visibility: "unknown" };

// ── System vitals (overview vital tiles: stability / development / population) ──
export interface SystemVitalsStability {
  /** (1 − unrest) × 100. */
  pct: number;
  unrest: number;
}
export interface SystemVitalsDevelopment {
  /** Raw tier-weighted `developmentPoints` — same units as the map choropleth. */
  points: number;
  /** This system's own full-build-out ceiling (`developmentPotential`), not a universe-wide reference. */
  potential: number;
  /** clamp(points / potential, 0, 1) × 100 — never exceeds 100 even though `points` can slightly
   *  exceed a base-heads-only `potential`. */
  pct: number;
}
/** Population composition — always sums to max(0, headcount). */
export interface SystemVitalsPopulationComposition {
  unskilled: number;
  technicians: number;
  engineers: number;
  unemployed: number;
}
export interface SystemVitalsPopulation {
  headcount: number;
  composition: SystemVitalsPopulationComposition;
}
/** Assembled read for the overview's three vital tiles — discriminated on visibility. */
export type SystemVitalsData =
  | {
      visibility: "visible";
      stability: SystemVitalsStability;
      development: SystemVitalsDevelopment;
      population: SystemVitalsPopulation;
      /** Provisioned, its band and the remembered level — see `SystemProvisionRead`. */
      provision: SystemProvisionRead;
    }
  | { visibility: "unknown" };

// ── System substrate (physical / static — astrography flavour) ───────────────
export interface BodyView {
  id: string;
  bodyType: BodyArchetypeId;
  archetypeName: string;
  /** This body's default-pop habitability score — the archetype's static rating in [0, 1].
   *  Presented as a labelled percentage under "Habitability" (`body-readout.tsx`), never the
   *  deposit-quality band vocabulary (Poor/Average/Good/Rich), which grades extraction yield. The
   *  system-level figure of the same name is a different quantity — a fold across occupied bodies,
   *  not an average of this one. */
  score: number;
  /** True when this body's archetype is tech-locked (contributes no land or counts yet). */
  locked: boolean;
  /** Per-resource deposit slot counts on this body (0 = no deposit). */
  counts: ResourceVector;
  /** Per-resource intrinsic quality multiplier on this body (0 = no deposit). */
  quality: ResourceVector;
  /** Per-resource deposit slots on this body inside the system's current worked prefix
   *  (`workedByBody`, `lib/engine/worked-deposits.ts`) — this body's own physical occupancy, never
   *  the system's blended yield. 0 where `counts[r]` is 0. */
  workedCounts: ResourceVector;
  /** This body's authored people-land budget — dark (present but non-functional) when locked or
   *  below `HABITABILITY_THRESHOLD`. */
  peopleLand: number;
  /** True when this body sits inside the system's current fill-best-first occupied prefix (the
   *  cached habitability quality fold, derived by the service via `occupiedBodyIds` — the component computes
   *  nothing). False for an unassessed system as well as for a body past the frontier. */
  occupied: boolean;
  /** This body's ring, 1..n over the system's bodies (ring 1 innermost) — cosmetic, read only by
   *  the system-view ring drawing, never by an engine term. Resolved from `WorldBody.orbitIndex`
   *  where every body in the system carries one; where any is missing (a save predating the
   *  field), the WHOLE system falls back to array position so the result is always a permutation
   *  of `1..n` (`docs/active/gameplay/system-view.md` → "Save and generation"). */
  orbitIndex: number;
  /** Display flavour only — the ring-drawing's circle radius. Passed through from `WorldBody.size`
   *  unchanged; carries no budget meaning and drives nothing else. */
  size: number;
}

/**
 * Physical substrate for one system — the static "what is physically here":
 * star, surface size, habitable fraction, bodies, and the deposits they host.
 * Discriminated on fog-of-war visibility. (Built-out / production state lives on
 * the tick-aware industry read.)
 */
export type SystemSubstrateData =
  | {
      visibility: "visible";
      sunClass: SunClass;
      /** Habitable surface across all bodies. */
      peopleLand: number;
      bodies: BodyView[];
      /** Per-resource potential yield across every body, locked bodies included (`potentialYieldByResource`,
       *  `lib/engine/worked-deposits.ts`) — the Astrography "what could this system be worth"
       *  table, distinct from the industry panel's worked-prefix (currently-realised) figure. */
      potentialYields: PotentialYieldRowView[];
    }
  | { visibility: "unknown" };

// ── System industry (built base + supply-chain + output — functional/dynamic) ─
import type {
  SystemIndustryReadout,
  SubstrateSpace,
  SystemDepositSummary,
} from "@/lib/engine/industry";
export type { SystemIndustryReadout, SubstrateSpace, SystemDepositSummary, SubstrateGoodRate };
/**
 * Industrial base, development headroom, deposit-fill, supply-chain and
 * production/consumption for one system — discriminated on visibility.
 */
export type SystemIndustryData =
  | ({
      visibility: "visible";
      /** Stored unrest integral 0…1. Drives the decay-loop and the coarse health read. */
      unrest: number;
      /** The two disjoint land/deposit budgets (people, deposit) and built-out use of each. */
      space: SubstrateSpace;
      /** Per-resource deposit-fill rows: slot cap, worked slots, effective yield + band. */
      deposits: SystemDepositSummary[];
      /** Per-good production vs consumption from the built base + population (real yields). */
      goods: SubstrateGoodRate[];
      /** Pop needs, pressure-sorted — drives the strip chip and per-row pop-short markers. */
      popNeeds: PopNeedData[];
    } & SystemIndustryReadout)
  | { visibility: "unknown" };

// ── Construction (build-queue / colony-visibility) ────────────────────────────
import type { SystemConstructionRow } from "@/lib/engine/construction-readout";

/** Per-system Construction section state. `hidden` renders nothing (developed with nothing building);
 *  `empty` is the controlled-not-yet-colonised state; `visible` carries the rows for this system —
 *  `SystemConstructionRow`, never the lane arm (a lane carries no single `systemId`). `empty`/
 *  `visible` carry `factionId` so the section can link to the faction roll-up. */
export type SystemConstructionData =
  | { visibility: "hidden" }
  | { visibility: "empty"; control: "controlled"; factionId: string }
  | { visibility: "visible"; factionId: string; projects: SystemConstructionRow[] };

/** Faction command-summary card state — pool composition + automation switches + link lists. */
export interface FactionConstructionData {
  factionId: string;
  pool: number;
  poolBase: number;
  poolCentres: number;
  /** The player's switches; null on AI factions (no switches rendered). */
  automation: { build: boolean; colonisation: boolean; lanes: boolean } | null;
  /** Systems with open build projects — count desc, then name asc. */
  buildSystems: Array<{ systemId: string; systemName: string; count: number }>;
  /** Forming colonies — progress desc, then name asc. */
  colonies: Array<{
    systemId: string;
    systemName: string;
    progress: number;
  }>;
  /** Player-originated open projects across the faction. */
  orderedCount: number;
}


// ── Tracker (docs/active/gameplay/tracker.md — pinned/building/colonising roll-up) ──
import type { TrackerSections } from "@/lib/types/tracker";
/** One pinned system's row + card figures — the same derivations `SystemVitalsData` shows on the
 *  system panel, so there is one definition of how a system is doing rather than a second. */
export interface TrackerPinnedRow {
  systemId: string;
  systemName: string;
  population: number;
  /** Population against its cap — the early-warning crowding read; not clamped to 100, since
   *  reading past it is the signal. */
  populationPct: number;
  stabilityPct: number;
  /** Same raw 0…1 unrest `getSystemVitals`'s `stability.unrest` reads — carried through so the
   *  stability swatch colour is a straight read, not a `1 - stabilityPct / 100` re-derivation of a
   *  quantity the service already computed. */
  unrest: number;
  /** null when the economy has never assessed this system yet (`SystemProvisionRead`'s
   *  `assessed: false` arm) — the card renders an em-dash for it, never a 0% that would read as a
   *  measured famine. */
  provisionPct: number | null;
  developmentPct: number;
}
/** Shared name/label/progress-bar figures for a funded build or a forming colony row. */
export interface TrackerRowBase {
  systemId: string;
  systemName: string;
  label: string;
  progress: number;
  /** What the coming cycle adds, in `progress`'s own units — the row's bar draws it as a lighter
   *  segment ahead of the fill, the same forecast the system construction screen shows. 0 means
   *  the project absorbs nothing next cycle, which is what a forming colony behind the front reads. */
  nextCycleProgress: number;
  etaCycles: number | null;
}
/** One row for a funded build project. `projectId` is the required React key for a list of these:
 *  a single system routinely runs several concurrent build projects (housing, an extractor, an
 *  academy — the planner bundles gate-first), so `systemId` is NOT unique within `TrackerData.building`.
 *  Keying on it duplicated/left-behind rows across re-renders (React can't reconcile a repeated key). */
export interface TrackerBuildRow extends TrackerRowBase {
  projectId: string;
}
/** One row for a forming colony. No `projectId` — unlike builds, `systemId` IS unique within
 *  `TrackerData.colonising`: a system can never carry two concurrent `colony_establish` projects
 *  (`colonyEligibility`'s `already_forming` gate in lib/services/colony-eligibility.ts, and the
 *  autonomic planner's `inFlight` set in lib/engine/directed-build.ts, both refuse to start a
 *  second one). `systemId` is a safe React key here. */
export type TrackerColonyRow = TrackerRowBase;

/** Tracker panel roll-up: pinned systems, the funded construction front, and forming colonies. */
export interface TrackerData {
  /** Every system id on the player's pin list, in stored order and UNFILTERED — the write path
   *  (`setSystemPin`) accepts any system, so this is the only list that answers "is this system
   *  pinned right now". A pin-state control must join against this, never against `pinned`: that one
   *  drops ids whose system reads no vitals, which would leave a stored pin showing as unpinned and
   *  its toggle unable to clear it. */
  pinnedSystemIds: string[];
  /** Player-curated bookmarks, insertion order — the DISPLAY list, so pins whose system reads no
   *  vitals (abandoned back to unclaimed, or merely controlled) are filtered out rather than
   *  rendered with zeroed figures. A subset of `pinnedSystemIds`. */
  pinned: TrackerPinnedRow[];
  /** The player faction's funded front, builds only — forming colonies are `colonising`. */
  building: TrackerBuildRow[];
  /** Open build projects behind the front, not currently absorbing pool. */
  waitingCount: number;
  /** Every colony currently forming for the player's faction, funded or not this cycle. */
  colonising: TrackerColonyRow[];
  /** Which sections the player wants rendered — stored on `world.player`, so it travels with the
   *  save. It rides this payload rather than having a read of its own, the same split
   *  `pinnedSystemIds` uses: read here, written by the `setTrackerSection` worker command. A world
   *  with no player seat reads `DEFAULT_TRACKER_SECTIONS`. */
  sections: TrackerSections;
}
/** A section write's answer: the full record after the merge, never the one flag that was sent. */

// ── Player build-options surface (per-system verbs: colonise / build) ────────
import type { BuildOption } from "@/lib/engine/build-options";
import type { ColonyBlockReason } from "@/lib/types/colonisation";

/** One dialog/quick-add option: engine feasibility + display label + queue-aware ETA. */
export interface BuildOptionData extends BuildOption {
  label: string;
  /** ≈cycles until a 1-level order placed NOW would land (player queue position); null = stalled pool. */
  etaCycles: number | null;
}
/** The founding quote rendered under the Establish verb: seed sizing plus what committing costs. */
export interface ColonyPreviewData {
  sourceSystemId: string;
  sourceSystemName: string;
  seedPop: number;
  housingLevels: number;
  /** One-off fee charged when the establish first draws funding. */
  charter: number;
  /** Upper bound on the materials bill — the uncapped want, hence "up to" in the UI. */
  projectedBill: number;
  /** The affordability gate's whole threshold — charter + headroom × projectedBill, the same
   *  `foundingCommitmentCost` the order boundary checks. What must be AVAILABLE before the verb
   *  is accepted; only the charter is actually spent at the click. */
  commitment: number;
}
/** Per-system verb surface: which construction verb applies here and its feasibility. */
export type SystemBuildOptionsData =
  | { mode: "none" } // not the player's system (or no seat)
  | {
      mode: "colony";
      colony:
        | { state: "eligible"; preview: ColonyPreviewData }
        | {
            state: "ineligible";
            reason: ColonyBlockReason;
            /** The same quote the eligible branch shows, when the block still has one. Only
             *  `insufficient_funds` is priced; the physical blocks bail before a source or
             *  sizing exists, so they carry null. */
            preview: ColonyPreviewData | null;
          };
    }
  | { mode: "build"; options: BuildOptionData[] };

// ── Faction vitals (Overview aggregate tiles: territory / population / stability / development) ──
/**
 * Faction-level roll-up of the same vitals the system overview shows, aggregated over the faction's
 * economically-active systems. Extensive quantities (population, development points/potential) SUM;
 * stability is a POPULATION-WEIGHTED mean so a populous core dominates and spreading into small
 * systems can't dilute it. Tick-dynamic, so it rides the tick-invalidated read (separate from the
 * static faction detail). Not visibility-gated — the faction screen is a god-view.
 */
export interface FactionVitalsData {
  /** Every system the faction owns (regardless of development). */
  territorySize: number;
  /** Systems that contribute to the pop/stability/development roll-up (control === "developed"). */
  activeSystemCount: number;
  /** Σ population across active systems. */
  population: number;
  /** Population-weighted mean stability (1 − unrest) × 100; 0 when the faction has no active systems. */
  stabilityPct: number;
  /** Σ tier-weighted development points — same units as the map choropleth. */
  developmentPoints: number;
  /** Σ development potential (the tile meter's denominator). */
  developmentPotential: number;
  /** clamp(Σpoints / Σpotential, 0, 1) × 100 — the faction's overall build-out vs its ceiling. */
  developmentPct: number;
}

// ── Faction treasury (the purse — player surfaces) ───────────────
import type { TreasuryBands } from "@/lib/engine/treasury";
import type { WorldTreasurySettlement } from "@/lib/world/types";
import type { TaxLevel } from "@/lib/types/game";

/**
 * One faction's treasury surface — read straight off the persisted
 * `WorldFactionTreasury` (no recomputation; the settlement snapshot exists so
 * UI reads never touch transients). Not player-gated: the faction screen is a
 * god-view; only writes are seat-gated.
 */
export interface FactionTreasuryData {
  factionId: string;
  /** ≥ 0 — no debt instrument. */
  balance: number;
  taxLevel: TaxLevel;
  /** Funding sliders (0-1); maintenance ≥ 0.5 at every write boundary. */
  bands: TreasuryBands;
  /** Latched paid-fractions from the last settlement — what each band's consumers run at ("runs"). */
  funded: TreasuryBands;
  /** Last settlement's income − money paid; 0 before the first settlement. */
  net: number;
  /** Money already committed to founding (paid charters + staged materials) awaiting settlement —
   *  still inside `balance` until the settlement charges it off, but no longer spendable. */
  foundingCommitted: number;
  lastSettlement: WorldTreasurySettlement | null;
}

/** The mutable policy pair the PATCH route returns after a successful write. */
export interface TreasuryPolicyData {
  taxLevel: TaxLevel;
  bands: TreasuryBands;
}

// ── Alert bar ──────────────────────────────────────────────────────────────
import type { AlertCategoryId, AlertCategorySettings } from "@/lib/types/alerts";

/**
 * One thing an alert category is naming — the flyout's row. What that thing is depends on the
 * category's `unit`: a system for the two system-scoped units, an EVENT for the three event bands,
 * and the faction itself for Maintenance unfunded.
 *
 * `measure` is the row's human-readable figure; `sortKey` is the number instances sort by WITHIN
 * their category, ascending — smaller sorts first, and each category picks what "smaller" means so
 * that ordering is always worst-first (see `lib/services/alerts.ts` for each category's convention).
 *
 * `systemId` is genuinely nullable and a consumer must handle the null: Maintenance unfunded emits a
 * faction-level row with no system, and an event row carries whatever `WorldEvent.systemId` holds —
 * the relations-spawned pair events (`pact_under_negotiation`, `alliance_dissolved`) have no system
 * at all. A null means the row is not navigable to a system; `name` still names its subject (the
 * faction, or the event type).
 */
export interface AlertInstance {
  systemId: string | null;
  name: string;
  measure: string;
  sortKey: number;
}

interface AlertCategoryBase {
  id: AlertCategoryId;
  /** Raw instance count — extensive, not a rate; grows with the empire. */
  count: number;
  instances: AlertInstance[];
}

/**
 * A category counting SYSTEMS out of the player faction's developed-systems total — the flyout
 * footer's and the chip's accessible name's "N of D developed systems".
 */
export interface SystemScopedAlertCategory extends AlertCategoryBase {
  unit: "developed_systems";
  /** The player faction's developed-systems count — shared across every category with this unit. */
  denominator: number;
}

/**
 * A category counting the player faction's CONTROLLED (claimed, not yet developed) systems out of
 * that total — the flyout footer's "N of D controlled systems". Colony opportunity is the one
 * category scoped this way, and it has to be: a colony candidate is by definition not developed yet,
 * so counting it against the developed-systems total compares two disjoint populations and can
 * render "3 of 1 developed systems". `controlled` is the population the colonisation planner draws
 * its candidates from (`lib/world/tick.ts`'s `developProvider` filters on exactly this control
 * state), so the count really is a share of this denominator.
 */
export interface ControlledSystemsAlertCategory extends AlertCategoryBase {
  unit: "controlled_systems";
  /** The player faction's controlled-but-undeveloped systems count. */
  denominator: number;
}

/**
 * The one faction-level category — Maintenance unfunded — counting the FACTION's own treasury
 * settlement, with no denominator. Its `count` is 0 or 1 by construction (one settlement per
 * faction), so a developed-systems denominator would render "1 of 253 developed systems" about a row
 * that names no system at all: the count is not a share of anything, the same reason the event
 * categories carry none.
 */
export interface FactionAlertCategory extends AlertCategoryBase {
  unit: "faction";
}

/** One alert category's standing read: the chip's count, what that count counts (and, for the
 *  system-scoped categories, its denominator — which population it is a share OF depends on `unit`),
 *  and the instance rows in the category's own sort order. */
export type AlertCategory =
  | SystemScopedAlertCategory
  | ControlledSystemsAlertCategory
  | FactionAlertCategory;

/** The alert bar's whole read — all thirteen categories, one endpoint rather than one per category.
 *  With a player seat, `getAlertData()` (lib/services/alerts.ts) always emits every category id,
 *  tier-then-order sorted; a category with nothing to say still appears, with `count: 0` and an empty
 *  `instances` array — the chip run is what decides whether an empty category renders anything. A
 *  world with no player seat (e.g. the calibration harness) reads `categories: []` entirely, the same
 *  posture `TrackerData` takes for the same reason. */
export interface AlertData {
  categories: AlertCategory[];
  /** Which categories the player wants on the bar — stored on `world.player`, so it travels with
   *  the save. Distinct from `categories` above: that is what each category currently SAYS, this is
   *  whether the player wants to be shown it at all. It rides this payload rather than having a read
   *  of its own, the same split `pinnedSystemIds` uses: read here, written by the
   *  `setAlertCategory` worker command. A world with no player seat reads
   *  `DEFAULT_ALERT_CATEGORIES`. */
  categorySettings: AlertCategorySettings;
}
/** A category write's answer: the full record after the merge, never the one flag that was sent. */
