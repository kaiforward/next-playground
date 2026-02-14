/**
 * Simulator types — in-memory world model for economy testing.
 * No DB dependency. All data is plain objects.
 */

import type { EconomyType, RegionIdentity } from "@/lib/types/game";
import type { ModifierRow } from "@/lib/engine/events";
import type { SimConstants, SimConstantOverrides } from "./constants";

// ── World model ─────────────────────────────────────────────────

export interface SimRegion {
  id: string;
  name: string;
  identity: RegionIdentity;
}

export interface SimSystem {
  id: string;
  name: string;
  economyType: EconomyType;
  regionId: string;
  /** Goods this economy type produces. */
  produces: string[];
  /** Goods this economy type consumes. */
  consumes: string[];
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
}

// ── Metrics ─────────────────────────────────────────────────────

export interface TickMetrics {
  tick: number;
  credits: number;
  tradeCount: number;
  tradeProfitSum: number;
  fuelSpent: number;
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
}

export interface SimResults {
  config: SimConfig;
  constants: SimConstants;
  overrides: SimConstantOverrides;
  summaries: PlayerSummary[];
  /** Optional label for experiment tracking. */
  label?: string;
  /** Total wall-clock time in ms. */
  elapsedMs: number;
}
