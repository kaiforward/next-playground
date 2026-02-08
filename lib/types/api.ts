import type {
  PlayerState,
  UniverseData,
  StarSystemInfo,
  MarketEntry,
  TradeHistoryEntry,
  TradeType,
} from "./game";

// ── Responses ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type PlayerResponse = ApiResponse<PlayerState>;
export type UniverseResponse = ApiResponse<UniverseData>;
export type SystemDetailResponse = ApiResponse<
  StarSystemInfo & { station: { id: string; name: string } | null }
>;
export type MarketResponse = ApiResponse<{ stationId: string; entries: MarketEntry[] }>;
export type TradeHistoryResponse = ApiResponse<TradeHistoryEntry[]>;

export interface TradeResult {
  player: PlayerState;
  updatedMarket: MarketEntry;
}
export type TradeResponse = ApiResponse<TradeResult>;

export interface NavigateResult {
  player: PlayerState;
  fuelUsed: number;
}
export type NavigateResponse = ApiResponse<NavigateResult>;

// ── Requests ─────────────────────────────────────────────────────

export interface TradeRequest {
  stationId: string;
  goodId: string;
  quantity: number;
  type: TradeType;
}

export interface NavigateRequest {
  targetSystemId: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}
