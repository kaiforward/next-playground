import type {
  GameWorldState,
  UniverseData,
  AtlasData,
  StarSystemInfo,
  StaticTileSystem,
  DynamicTileSystem,
  MarketEntry,
  MarketComparisonEntry,
  GoodInfo,
  ActiveEvent,
  SunClass,
  GoodTier,
  BodyArchetypeId,
  StabilityEntry,
  PopulationEntry,
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
export type DynamicTileResponse = ApiResponse<{ systems: DynamicTileSystem[] }>;
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
/** The two overlay edge sets the map renders — market diffusion and directed logistics. */
export interface TradeFlowEdges {
  marketEdges: TradeFlowEdgeInfo[];
  logisticsEdges: TradeFlowEdgeInfo[];
}
export type TradeFlowResponse = ApiResponse<TradeFlowEdges>;
export type StabilityResponse = ApiResponse<{ systems: StabilityEntry[] }>;
export type PopulationResponse = ApiResponse<{ systems: PopulationEntry[] }>;
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
  importMarket: number;
  importLogistics: number;
  exportMarket: number;
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
/** One good's contribution to the population demand footprint. */
export interface PopulationDemandEntry {
  goodId: string;
  goodName: string;
  /** Demand rate (units/tick) generated by this system's population. */
  demandRate: number;
  /** demandRate's composition — base + technicians + engineers (floored at MIN_DEMAND, so the terms may sum to less than demandRate on tiny systems). */
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
      /** Full consumption footprint — goods the population consumes, demand-sorted descending. */
      demand: PopulationDemandEntry[];
    }
  | { visibility: "unknown" };
export type SystemPopulationResponse = ApiResponse<SystemPopulationData>;

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
    } & SystemIndustryReadout)
  | { visibility: "unknown" };
export type SystemIndustryResponse = ApiResponse<SystemIndustryData>;

export type MarketResponse = ApiResponse<{ stationId: string; entries: MarketEntry[] }>;
export type MarketComparisonResponse = ApiResponse<{ goodId: string; entries: MarketComparisonEntry[] }>;
export type GoodsResponse = ApiResponse<{ goods: GoodInfo[] }>;
export type EventsResponse = ApiResponse<ActiveEvent[]>;

import type {
  FactionSummary,
  FactionDetail,
  RelationsMatrixData,
} from "@/lib/services/factions";
export type FactionListResponse = ApiResponse<FactionSummary[]>;
export type FactionDetailResponse = ApiResponse<FactionDetail>;
export type RelationsMatrixResponse = ApiResponse<RelationsMatrixData>;

