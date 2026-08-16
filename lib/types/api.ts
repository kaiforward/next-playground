import type {
  GameWorldState,
  UniverseData,
  AtlasData,
  StarSystemInfo,
  StaticTileSystem,
  MarketEntry,
  MarketComparisonEntry,
  ActiveEvent,
  SunClass,
  GoodTier,
  BodyArchetypeId,
  StabilityEntry,
  PopulationEntry,
  DevelopmentEntry,
  MigrationEntry,
  ProvisionEntry,
  OwnershipEntry,
  ResourceVector,
} from "./game";
import type { SubstrateGoodRate, ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import type { SupplyRegime } from "@/lib/engine/population";
import type { SaveInfo } from "@/lib/world/save-files";
import type { WorldMeta } from "@/lib/world/types";

// ── Responses ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type GameWorldResponse = ApiResponse<GameWorldState>;
export type SavesResponse = ApiResponse<SaveInfo[]>;
export type SaveGameResponse = ApiResponse<{ name: string; tick: number }>;
export type LoadGameResponse = ApiResponse<WorldMeta>;
export type NewGameResponse = ApiResponse<WorldMeta>;
export type UniverseResponse = ApiResponse<UniverseData>;
export type AtlasResponse = ApiResponse<AtlasData>;
export type StaticTileResponse = ApiResponse<{ systems: StaticTileSystem[] }>;
export type VisibilityResponse = ApiResponse<{ systemIds: string[] }>;
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
export type TradeFlowResponse = ApiResponse<TradeFlowEdges>;
export type StabilityResponse = ApiResponse<{ systems: StabilityEntry[] }>;
export type PopulationResponse = ApiResponse<{ systems: PopulationEntry[] }>;
export type DevelopmentResponse = ApiResponse<{ systems: DevelopmentEntry[] }>;
export type MigrationResponse = ApiResponse<{ systems: MigrationEntry[] }>;
export type ProvisionResponse = ApiResponse<{ systems: ProvisionEntry[] }>;
export type OwnershipResponse = ApiResponse<{ systems: OwnershipEntry[] }>;
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
export type SystemCadenceResponse = ApiResponse<SystemCadence>;
export type SystemLogisticsResponse = ApiResponse<SystemLogisticsData>;

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
export type SystemDetailResponse = ApiResponse<SystemDetailData>;

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
    }
  | { visibility: "unknown" };
export type SystemPopulationResponse = ApiResponse<SystemPopulationData>;

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
export type SystemVitalsResponse = ApiResponse<SystemVitalsData>;

// ── System substrate (physical / static — astrography flavour) ───────────────
export interface BodyView {
  id: string;
  bodyType: BodyArchetypeId;
  archetypeName: string;
  habitable: boolean;
  size: number;
  /** Per-resource deposit slots on this body (0 = no deposit). */
  slots: ResourceVector;
  /** Per-resource intrinsic quality multiplier on this body (0 = no deposit). */
  quality: ResourceVector;
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
      /** Total available surface space across all bodies (SPACE_PER_SIZE × Σ size). */
      availableSpace: number;
      /** Habitable surface across all bodies. */
      habitableSpace: number;
      bodies: BodyView[];
    }
  | { visibility: "unknown" };
export type SystemSubstrateResponse = ApiResponse<SystemSubstrateData>;

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
      /** Available-space partition + built-out land per partition (headroom). */
      space: SubstrateSpace;
      /** Per-resource deposit-fill rows: slot cap, worked slots, effective yield + band. */
      deposits: SystemDepositSummary[];
      /** Per-good production vs consumption from the built base + population (real yields). */
      goods: SubstrateGoodRate[];
      /** Pop needs, pressure-sorted — drives the strip chip and per-row pop-short markers. */
      popNeeds: PopNeedData[];
    } & SystemIndustryReadout)
  | { visibility: "unknown" };
export type SystemIndustryResponse = ApiResponse<SystemIndustryData>;

// ── Construction (build-queue / colony-visibility) ────────────────────────────
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";

/** Per-system Construction section state. `hidden` renders nothing (developed with nothing building);
 *  `empty` is the controlled-not-yet-colonised state; `visible` carries the rows for this system.
 *  `empty`/`visible` carry `factionId` so the section can link to the faction roll-up. */
export type SystemConstructionData =
  | { visibility: "hidden" }
  | { visibility: "empty"; control: "controlled"; factionId: string }
  | { visibility: "visible"; factionId: string; projects: ConstructionProjectRow[] };

/** Faction command-summary card state — pool composition + automation switches + link lists. */
export interface FactionConstructionData {
  factionId: string;
  pool: number;
  poolBase: number;
  poolCentres: number;
  /** The player's switches; null on AI factions (no switches rendered). */
  automation: { build: boolean; colonisation: boolean } | null;
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

export type SystemConstructionResponse = ApiResponse<SystemConstructionData>;
export type FactionConstructionResponse = ApiResponse<FactionConstructionData>;

// ── Tracker (docs/active/gameplay/tracker.md — pinned/building/colonising roll-up) ──
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
}
export type TrackerResponse = ApiResponse<TrackerData>;

// ── Player build-options surface (per-system verbs: colonise / build) ────────
import type { BuildOption } from "@/lib/engine/build-options";
import type { ColonyBlockReason } from "@/lib/types/colonisation";

/** One dialog/quick-add option: engine feasibility + display label + queue-aware ETA. */
export interface BuildOptionData extends BuildOption {
  label: string;
  /** ≈cycles until a 1-level order placed NOW would land (player queue position); null = stalled pool. */
  etaCycles: number | null;
}
/** Per-system verb surface: which construction verb applies here and its feasibility. */
export type SystemBuildOptionsData =
  | { mode: "none" } // not the player's system (or no seat)
  | {
      mode: "colony";
      colony:
        | {
            state: "eligible";
            preview: {
              sourceSystemId: string;
              sourceSystemName: string;
              seedPop: number;
              housingLevels: number;
              work: number;
              /** One-off fee charged when the establish first draws funding. */
              charter: number;
              /** Upper bound on the materials bill — the uncapped want, hence "up to" in the UI. */
              projectedBill: number;
            };
          }
        | { state: "ineligible"; reason: ColonyBlockReason };
    }
  | { mode: "build"; options: BuildOptionData[] };
export type SystemBuildOptionsResponse = ApiResponse<SystemBuildOptionsData>;

// ── Player construction verbs (build/colony orders, cancel, automation) ──────
export type OrderBuildResponse = ApiResponse<{ projectId: string; levels: number }>;
export type OrderColonyResponse = ApiResponse<{ projectId: string }>;
export type CancelOrderResponse = ApiResponse<{ projectId: string }>;
export type AutomationResponse = ApiResponse<{ build: boolean; colonisation: boolean }>;
export type PinsResponse = ApiResponse<string[]>;

export type MarketResponse = ApiResponse<{ stationId: string; entries: MarketEntry[] }>;
export type MarketComparisonResponse = ApiResponse<{ goodId: string; entries: MarketComparisonEntry[] }>;
export type EventsResponse = ApiResponse<ActiveEvent[]>;

import type {
  FactionSummary,
  FactionDetail,
  RelationsMatrixData,
} from "@/lib/services/factions";
export type FactionListResponse = ApiResponse<FactionSummary[]>;
export type FactionDetailResponse = ApiResponse<FactionDetail>;
export type RelationsMatrixResponse = ApiResponse<RelationsMatrixData>;

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
export type FactionVitalsResponse = ApiResponse<FactionVitalsData>;

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
  lastSettlement: WorldTreasurySettlement | null;
}
export type FactionTreasuryResponse = ApiResponse<FactionTreasuryData>;

/** The mutable policy pair the PATCH route returns after a successful write. */
export interface TreasuryPolicyData {
  taxLevel: TaxLevel;
  bands: TreasuryBands;
}
export type UpdateTreasuryPolicyResponse = ApiResponse<TreasuryPolicyData>;

// ── Alert bar (docs/build-plans/alert-bar.md — state-derived categories) ────
import type { AlertCategoryId } from "@/lib/types/alerts";

/**
 * One system (or, for the event-banded categories not yet built, an event) an alert category
 * is naming — the flyout's row. `measure` is the row's human-readable figure; `sortKey` is the
 * number instances sort by WITHIN their category, ascending — smaller sorts first, and each
 * category picks what "smaller" means so that ordering is always worst-first (see
 * `lib/services/alerts.ts` for each category's convention). `systemId` is `string | null` for the
 * interface's sake — every category built so far is system-scoped, so it is never null here.
 */
export interface AlertInstance {
  systemId: string | null;
  name: string;
  measure: string;
  sortKey: number;
}

/** One alert category's standing read: the chip's count, the flyout footer's denominator ("N of D
 *  developed systems"), and the instance rows in the category's own sort order. */
export interface AlertCategory {
  id: AlertCategoryId;
  /** Raw instance count — extensive, not a rate; grows with the empire (alert-bar.md:287-291). */
  count: number;
  /** The player faction's developed-systems count — shared across every system-scoped category. */
  denominator: number;
  instances: AlertInstance[];
}

/** The alert bar's whole read. Categories not yet built (events, Build blocked, Industry idle, the
 *  opportunity/windfall categories, Maintenance unfunded, Survival stock falling, Demand unservable)
 *  are absent from the array rather than present with an empty read — each is added here as it
 *  ships, rather than owning a separate endpoint. */
export interface AlertData {
  categories: AlertCategory[];
}
export type AlertResponse = ApiResponse<AlertData>;
