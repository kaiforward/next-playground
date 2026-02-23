/**
 * Simulator types — in-memory world model for economy testing.
 * No DB dependency. All data is plain objects.
 */

import type { EconomyType, GovernmentType } from "@/lib/types/game";
import type { ModifierRow } from "@/lib/engine/events";
import type { SimConstants, SimConstantOverrides } from "./constants";
import type { SimAdjacencyList } from "./pathfinding-cache";

// ── World model ─────────────────────────────────────────────────

export interface SimRegion {
  id: string;
  name: string;
  governmentType: GovernmentType;
}

export interface SimSystem {
  id: string;
  name: string;
  economyType: EconomyType;
  regionId: string;
  /** Goods this economy type produces, keyed by goodId → rate. */
  produces: Record<string, number>;
  /** Goods this economy type consumes, keyed by goodId → rate. */
  consumes: Record<string, number>;
  /** System traits from generation (used for production modifiers). */
  traits: { traitId: string; quality: number }[];
}

export interface SimConnection {
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

export interface SimMarketEntry {
  systemId: string;
  goodId: string;
  basePrice: number;
  supply: number;
  demand: number;
  priceFloor: number;
  priceCeiling: number;
}

export interface SimEvent {
  id: string;
  type: string;
  phase: string;
  systemId: string;
  regionId: string;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
}

export interface SimShip {
  id: string;
  playerId: string;
  shipType: string;
  fuel: number;
  maxFuel: number;
  cargo: SimCargoItem[];
  cargoMax: number;
  speed: number;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  firepower: number;
  evasion: number;
  stealth: number;
  disabled: boolean;
  status: "docked" | "in_transit";
  systemId: string;
  destinationSystemId: string | null;
  arrivalTick: number | null;
}

export interface SimCargoItem {
  goodId: string;
  quantity: number;
}

export interface SimPlayer {
  id: string;
  name: string;
  credits: number;
  strategy: string;
}

export interface SimWorld {
  tick: number;
  regions: SimRegion[];
  systems: SimSystem[];
  connections: SimConnection[];
  markets: SimMarketEntry[];
  events: SimEvent[];
  modifiers: ModifierRow[];
  ships: SimShip[];
  players: SimPlayer[];
  /** Monotonic counter for generating unique IDs. */
  nextId: number;
}

// ── Configuration ───────────────────────────────────────────────

export interface BotConfig {
  strategy: string;
  count: number;
}

export interface SimConfig {
  tickCount: number;
  bots: BotConfig[];
  seed: number;
  /** Optional: inject events at specific ticks. */
  eventInjections?: EventInjection[];
  /** When true, suppresses random event spawning (injections still fire). */
  disableRandomEvents?: boolean;
}

export type InjectionTarget =
  | { economyType: string; nth?: number }
  | { systemIndex: number };

export interface EventInjection {
  tick: number;
  target: InjectionTarget;
  eventType: string;
  severity?: number;
}

/** Runtime context threaded through the simulation loop. */
export interface SimRunContext {
  constants: SimConstants;
  disableRandomEvents: boolean;
  eventInjections: EventInjection[];
  /** Pre-built adjacency list for simulator pathfinding (avoids rebuilding per call). */
  adjacencyList: SimAdjacencyList;
  /** Map from systemId → governmentType for sell tracking. */
  systemToGov: Map<string, string>;
}

// ── Metrics ─────────────────────────────────────────────────────

export interface GoodTradeRecord {
  goodId: string;
  /** Quantity bought (0 if only sold this tick). */
  bought: number;
  /** Quantity sold (0 if only bought this tick). */
  sold: number;
  /** Credits spent buying. */
  buyCost: number;
  /** Credits earned selling. */
  sellRevenue: number;
  /** Government type of the system where a sell occurred. */
  sellGovernmentType?: string;
}

export interface TickMetrics {
  tick: number;
  credits: number;
  tradeCount: number;
  tradeProfitSum: number;
  fuelSpent: number;
  /** Per-good trade data recorded this tick. */
  goodsTraded: GoodTradeRecord[];
  /** System the bot was at (or departed from) this tick. Null if in transit. */
  systemVisited: string | null;
  /** True if the bot was docked but found no profitable trade this tick. */
  idle: boolean;
}

export interface GoodBreakdownEntry {
  goodId: string;
  timesBought: number;
  timesSold: number;
  totalQuantityBought: number;
  totalQuantitySold: number;
  totalSpent: number;
  totalRevenue: number;
  netProfit: number;
}

export interface PlayerSummary {
  playerId: string;
  playerName: string;
  strategy: string;
  finalCredits: number;
  totalTrades: number;
  avgProfitPerTrade: number;
  creditsPerTick: number;
  /** Tick when player first reached 5000 credits (freighter milestone), or null. */
  freighterTick: number | null;
  totalFuelSpent: number;
  profitPerFuel: number;
  /** Credits at each tick for charting. */
  creditsCurve: number[];
  /** Aggregate stats per good across the full run. */
  goodBreakdown: GoodBreakdownEntry[];
  /** Number of unique systems visited during the run. */
  uniqueSystemsVisited: number;
  /** Top 5 most-visited systems with visit counts. */
  topSystems: { systemId: string; systemName: string; visits: number }[];
  /** Fraction of total systems visited at least once. */
  explorationRate: number;
  /** Number of ticks spent docked with no trade available. */
  idleTicks: number;
  /** Idle rate as fraction of total docked ticks. */
  idleRate: number;
  /** Earning rate per tick as a rolling window (window size = 50 ticks). */
  earningRateCurve: number[];
  /** Breakdown of sell trades by destination government type. */
  governmentSellBreakdown: GovernmentSellEntry[];
}

export interface GovernmentSellEntry {
  governmentType: string;
  totalSold: number;
  totalRevenue: number;
}

// ── Market health ───────────────────────────────────────────────

export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  supply: number;
  demand: number;
  price: number;
}

export interface MarketHealthSummary {
  /** Per-good average price standard deviation across systems (high = trade opportunity). */
  priceDispersion: { goodId: string; avgStdDev: number }[];
  /** Per-good average distance from equilibrium at simulation end. */
  equilibriumDrift: { goodId: string; avgSupplyDrift: number; avgDemandDrift: number }[];
}

// ── Event impact ────────────────────────────────────────────────

/** Price snapshot for a single good at event boundary. */
export interface EventBoundaryPrice {
  goodId: string;
  price: number;
}

/** Lifecycle record for an event (tracked during simulation). */
export interface EventLifecycle {
  id: string;
  type: string;
  systemId: string;
  severity: number;
  startTick: number;
  endTick: number;
  sourceEventId: string | null;
  /** Prices at the event's system when the event started. */
  startPrices: EventBoundaryPrice[];
  /** Prices at the event's system when the event ended. */
  endPrices: EventBoundaryPrice[];
}

/** Per-good price change during an event. */
export interface GoodPriceChange {
  goodId: string;
  priceBefore: number;
  priceAfter: number;
  changePct: number;
}

export interface EventImpact {
  eventId: string;
  eventType: string;
  systemId: string;
  systemName: string;
  severity: number;
  startTick: number;
  endTick: number;
  duration: number;
  /** null for root events, event type string for child/spread events. */
  parentEventType: string | null;
  /** Per-good price changes between event start and end. */
  goodPriceChanges: GoodPriceChange[];
  /** Base-price-weighted average price change across all goods (%). */
  weightedPriceImpactPct: number;
  /** Number of bot-ticks at this system during the event. */
  botVisitsDuring: number;
  /** Number of trades executed at this system during the event. */
  tradeCountDuring: number;
  /** Total profit earned at this system during the event. */
  tradeProfitDuring: number;
}

// ── Results ─────────────────────────────────────────────────────

export interface SimResults {
  config: SimConfig;
  constants: SimConstants;
  overrides: SimConstantOverrides;
  summaries: PlayerSummary[];
  /** Market state sampled at regular intervals. */
  marketSnapshots: { tick: number; markets: MarketSnapshot[] }[];
  /** Derived market health metrics. */
  marketHealth: MarketHealthSummary;
  /** Impact measurement for each event that occurred. */
  eventImpacts: EventImpact[];
  /** Region overview for understanding the generated universe. */
  regionOverview: RegionOverviewEntry[];
  /** Optional label for experiment tracking. */
  label?: string;
  /** Total wall-clock time in ms. */
  elapsedMs: number;
}

export interface RegionOverviewEntry {
  name: string;
  governmentType: string;
  systemCount: number;
}
