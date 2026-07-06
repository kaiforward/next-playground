import type {
  FleetState,
  ShipState,
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
  TraitId,
  TraitCategory,
  QualityTier,
  SunClass,
  GoodTier,
  BodyArchetypeId,
  StabilityEntry,
  PopulationEntry,
  ResourceVector,
} from "./game";
import type { GlobalEventMap, PlayerEventMap } from "@/lib/tick/types";
import type { SubstrateGoodRate, ConsumptionBreakdown } from "@/lib/engine/physical-economy";

// ── Responses ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type FleetResponse = ApiResponse<FleetState>;
export type GameWorldResponse = ApiResponse<GameWorldState>;
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

// ── System cadence (header "next update" countdowns) ─────────────────────────
/**
 * Static per-system shard groups for the header cadence countdowns. Both never
 * change for a given universe (id-rank / faction-rank are fixed), so the client
 * fetches once (staleTime Infinity) and counts down off the live tick.
 */
export interface SystemCadence {
  /** Group in [0, ECONOMY_UPDATE_INTERVAL): when this system's economy shard runs. */
  economyShardGroup: number;
  /** Group in [0, DIRECTED_LOGISTICS.INTERVAL): when this faction's logistics/build shard runs. */
  logisticsShardGroup: number;
}
export type SystemCadenceResponse = ApiResponse<SystemCadence>;
export type SystemLogisticsResponse = ApiResponse<SystemLogisticsData>;
/** Enriched trait data returned from system detail API. */
export interface SystemTraitResponse {
  traitId: TraitId;
  quality: QualityTier;
  name: string;
  category: TraitCategory;
  description: string;
}

/** Full system detail — discriminated union on visibility. */
export type SystemDetailData =
  | (StarSystemInfo & {
      visibility: "visible";
      station: { id: string; name: string } | null;
      traits: SystemTraitResponse[];
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
      /** Economy shard this system lands in (0…ECONOMY_UPDATE_INTERVAL−1) — static.
       *  Paired with the live tick to count down to the next economy update. */
      economyShardGroup: number;
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

export interface ShipNavigateResult {
  ship: ShipState;
  fuelUsed: number;
  travelDuration: number;
}
export type ShipNavigateResponse = ApiResponse<ShipNavigateResult>;

/** Client-facing tick event (per-player filtered by SSE route). */
export interface TickEvent {
  currentTick: number;
  tickRate: number;
  /** Merged global events from all processors. */
  events: Partial<GlobalEventMap>;
  /** Player-scoped events (filtered to this client). */
  playerEvents: Partial<PlayerEventMap>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}

// ── Requests ─────────────────────────────────────────────────────

export interface ShipNavigateRequest {
  route: string[]; // ordered [origin, ...hops, destination]
}

export interface ShipRefuelRequest {
  amount: number;
}

export interface ShipRefuelResult {
  ship: ShipState;
  creditSpent: number;
}
export type ShipRefuelResponse = ApiResponse<ShipRefuelResult>;

// ── Auth types ──────────────────────────────────────────────────

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}
