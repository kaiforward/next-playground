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
  OwnershipEntry,
  ResourceVector,
} from "./game";
import type { SubstrateGoodRate, ConsumptionBreakdown } from "@/lib/engine/physical-economy";
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
  production: number;
  /** Civilian consumption (per-capita baseline + skilled baskets). */
  consumption: number;
  /** Manufacturing input demand — recipe draw from local factories. Also local consumption. */
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
 * Under the monthly resolution pulse the whole galaxy resolves together on
 * `tick % MONTH_LENGTH === 0`, so this is uniformly 0; the value never changes
 * for a given universe, so the client fetches once (staleTime Infinity) and
 * counts down off the live tick.
 */
export interface SystemCadence {
  /** Group in [0, MONTH_LENGTH): when the whole galaxy resolves. Always 0 under the monthly pulse; kept so the client counts down with ticksUntilShard(pulseGroup, tick, MONTH_LENGTH). */
  pulseGroup: number;
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
  /** demandShare × (1 − satisfaction)² — this good's contribution to the system's dissatisfaction/unrest. */
  pressure: number;
  /** want's composition — base + technicians + engineers. */
  breakdown: ConsumptionBreakdown;
}

/** Dynamic population & social state for one system — discriminated on visibility. */
export type SystemPopulationData =
  | {
      visibility: "visible";
      population: number;
      popCap: number;
      unrest: number;
      /** True when unrest ≥ STRIKE_PARAMS.threshold. */
      striking: boolean;
      /** Pop needs, pressure-sorted descending — the goods the population consumes and how met each want is. */
      needs: PopNeedData[];
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
  colonies: Array<{ systemId: string; systemName: string; progress: number }>;
  /** Player-originated open projects across the faction. */
  orderedCount: number;
}

export type SystemConstructionResponse = ApiResponse<SystemConstructionData>;
export type FactionConstructionResponse = ApiResponse<FactionConstructionData>;

// ── Player build-options surface (per-system verbs: colonise / build) ────────
import type { BuildOption } from "@/lib/engine/build-options";
import type { ColonyBlockReason } from "@/lib/types/colonisation";

/** One dialog/quick-add option: engine feasibility + display label + queue-aware ETA. */
export interface BuildOptionData extends BuildOption {
  label: string;
  /** ≈pulses until a 1-level order placed NOW would land (player queue position); null = stalled pool. */
  etaPulses: number | null;
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

