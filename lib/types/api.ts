import type {
  FleetState,
  ShipState,
  GameWorldState,
  UniverseData,
  StarSystemInfo,
  MarketEntry,
  TradeHistoryEntry,
  TradeType,
  ActiveEvent,
  SystemPriceHistory,
  TradeMissionInfo,
} from "./game";

// ── Responses ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type FleetResponse = ApiResponse<FleetState>;
export type GameWorldResponse = ApiResponse<GameWorldState>;
export type UniverseResponse = ApiResponse<UniverseData>;
export type SystemDetailResponse = ApiResponse<
  StarSystemInfo & { station: { id: string; name: string } | null }
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
