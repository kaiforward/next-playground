import type {
  FleetState,
  ShipState,
  ConvoyState,
  GameWorldState,
  UniverseData,
  StarSystemInfo,
  MarketEntry,
  TradeHistoryEntry,
  TradeType,
  ActiveEvent,
  SystemPriceHistory,
  TradeMissionInfo,
  TraitId,
  TraitCategory,
  QualityTier,
  SystemTraitInfo,
} from "./game";

// ── Responses ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type FleetResponse = ApiResponse<FleetState>;
export type GameWorldResponse = ApiResponse<GameWorldState>;
export type UniverseResponse = ApiResponse<UniverseData>;
/** Enriched trait data returned from system detail API. */
export interface SystemTraitResponse {
  traitId: TraitId;
  quality: QualityTier;
  name: string;
  category: TraitCategory;
  description: string;
}

export type SystemDetailResponse = ApiResponse<
  StarSystemInfo & {
    station: { id: string; name: string } | null;
    traits: SystemTraitResponse[];
  }
>;
export type MarketResponse = ApiResponse<{ stationId: string; entries: MarketEntry[] }>;
export type TradeHistoryResponse = ApiResponse<TradeHistoryEntry[]>;
export type EventsResponse = ApiResponse<ActiveEvent[]>;
export type PriceHistoryResponse = ApiResponse<SystemPriceHistory[]>;

export interface ShipTradeResult {
  ship: ShipState;
  updatedMarket: MarketEntry;
}
export type ShipTradeResponse = ApiResponse<ShipTradeResult>;

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
  events: Record<string, unknown[]>;
  /** Player-scoped events (filtered to this client). */
  playerEvents: Record<string, unknown[]>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}

// ── Requests ─────────────────────────────────────────────────────

export interface ShipTradeRequest {
  stationId: string;
  goodId: string;
  quantity: number;
  type: TradeType;
}

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

export interface ShipPurchaseRequest {
  systemId: string;
  shipType: string;
}

export interface ShipPurchaseResult {
  ship: ShipState;
  creditSpent: number;
}
export type ShipPurchaseResponse = ApiResponse<ShipPurchaseResult>;

// ── Mission types ───────────────────────────────────────────────

export interface SystemMissionsData { available: TradeMissionInfo[]; active: TradeMissionInfo[] }
export type SystemMissionsResponse = ApiResponse<SystemMissionsData>;

export interface AcceptMissionRequest { missionId: string }
export interface AcceptMissionResult { mission: TradeMissionInfo; activeCount: number }
export type AcceptMissionResponse = ApiResponse<AcceptMissionResult>;

export interface DeliverMissionRequest { missionId: string; shipId: string }
export interface DeliverMissionResult { mission: TradeMissionInfo; goodsValue: number; reward: number; creditEarned: number; newBalance: number }
export type DeliverMissionResponse = ApiResponse<DeliverMissionResult>;

export interface AbandonMissionRequest { missionId: string }
export type AbandonMissionResponse = ApiResponse<{ missionId: string }>;

// ── Convoy types ────────────────────────────────────────────────

export type ConvoyListResponse = ApiResponse<ConvoyState[]>;

export interface CreateConvoyRequest { shipIds: string[]; name?: string }
export interface CreateConvoyResult { convoy: ConvoyState }
export type CreateConvoyResponse = ApiResponse<CreateConvoyResult>;

export interface ConvoyMemberRequest { shipId: string }
export interface ConvoyBatchMemberRequest { shipIds: string[] }
export type ConvoyMemberResponse = ApiResponse<ConvoyState>;

export interface ConvoyNavigateRequest { route: string[] }
export type ConvoyNavigateResponse = ApiResponse<{ convoy: ConvoyState; fuelUsed: number; travelDuration: number }>;

// ── Convoy trade types ─────────────────────────────────────────

export interface ConvoyTradeResult { updatedMarket: MarketEntry }
export type ConvoyTradeResponse = ApiResponse<ConvoyTradeResult>;

// ── Convoy repair types ────────────────────────────────────────

export interface ConvoyRepairRequest { fraction: number }
export interface ConvoyRepairResult { totalCost: number; totalHealed: number }
export type ConvoyRepairResponse = ApiResponse<ConvoyRepairResult>;

// ── Convoy refuel types ────────────────────────────────────────

export interface ConvoyRefuelRequest { fraction: number }
export interface ConvoyRefuelResult { totalCost: number; totalFueled: number }
export type ConvoyRefuelResponse = ApiResponse<ConvoyRefuelResult>;

// ── Upgrade types ───────────────────────────────────────────────

export interface InstallUpgradeRequest { slotId: string; moduleId: string; tier?: number }
export interface InstallUpgradeResult { ship: ShipState; creditSpent: number }
export type InstallUpgradeResponse = ApiResponse<InstallUpgradeResult>;

export interface RemoveUpgradeRequest { slotId: string }
export type RemoveUpgradeResponse = ApiResponse<{ ship: ShipState }>;

// ── Repair types ────────────────────────────────────────────────

export interface RepairResult { ship: ShipState; creditSpent: number }
export type RepairResponse = ApiResponse<RepairResult>;

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
