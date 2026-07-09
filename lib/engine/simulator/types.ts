/**
 * Simulator types — shape types shared by the tick processors' in-memory
 * adapters (`lib/tick/adapters/memory/*`), plus the calibration harness's own
 * config/results/health types.
 *
 * The bot/player/world-orchestration types that used to live here (`SimWorld`,
 * `SimShip`, `SimPlayer`, `BotConfig`, per-tick trade metrics, …) died with the
 * bot layer — `World` (`lib/world/types.ts`) is the one world model now, and
 * `runWorldTick` (`lib/world/tick.ts`) is the one tick pipeline. What remains
 * here are the flat row shapes the shared memory adapters require (still
 * distinct from `World*` rows — see `lib/world/tick.ts`'s join helpers for the
 * bridge) and the harness's own config/results types.
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import type { World, SystemControl } from "@/lib/world/types";

// ── Adapter row shapes ──────────────────────────────────────────

export interface SimRegion {
  id: string;
  name: string;
}

export interface SimSystem {
  id: string;
  name: string;
  economyType: EconomyType;
  regionId: string;
  /** Owning faction's stable id, or null for independent systems. Drives the faction-bounded flow topology. */
  factionId: string | null;
  /** Three-state ownership — gates development builds and the claim/develop expansion steps. */
  control: SystemControl;
  /** Owning faction's government — sourced per-system. */
  governmentType: GovernmentType;
  /** Abstract population magnitude — drives labour + per-capita consumption. */
  population: number;
  /** Maximum sustainable population (logistic growth cap). */
  popCap: number;
  /** System traits from generation (used for production modifiers). */
  traits: { traitId: string; quality: number }[];
  /** Unrest accumulator (0…1) — integral of demand-weighted dissatisfaction. */
  unrest: number;
  /** Seeded industrial base — buildingType → count. */
  buildings: Record<string, number>;
  /** Per-resource yield multiplier (deposit quality) — feeds tier-0 production. */
  yields: ResourceVector;
  /** Body-derived deposit-slot capacity per resource — caps tier-0 extractor builds. */
  slotCap: ResourceVector;
  /** Body-derived fungible build space — tier-1+ factories + housing draw here. */
  generalSpace: number;
  /** Habitable subset of build space — additionally caps housing. */
  habitableSpace: number;
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
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none); written by the economy processor. */
  anchorMult: number;
  /** Stored local demand rate (civilian demand — per-capita baseline + skilled baskets — floored at seed). */
  demandRate: number;
  priceFloor: number;
  priceCeiling: number;
  /** Built infrastructure storage capacity for this good — the infrastructure term of maxStock. */
  storageCapacity: number;
}

export interface SimEvent {
  id: string;
  type: EventTypeId;
  phase: string;
  /** Target system, or null for region/pair-level events (e.g. relations-owned events). */
  systemId: string | null;
  /** Target region, or null. */
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
}

export interface SimFlowEvent {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

// ── Calibration harness config ──────────────────────────────────

export interface SimConfig {
  systemCount: number;
  seed: number;
  tickCount: number;
}

// ── Market health ───────────────────────────────────────────────

export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  stock: number;
  price: number;
}

export interface PriceLevelSummary {
  /** Median price / basePrice across all markets (galaxy-wide). */
  median: number;
  /** 10th percentile price / basePrice. */
  p10: number;
  /** 90th percentile price / basePrice. */
  p90: number;
  /** Fraction of markets below 0.9× base (cheap — overstocked). */
  cheapFrac: number;
  /** Fraction within 0.9–1.1× base (near the anchor). */
  nearFrac: number;
  /** Fraction above 1.1× base (expensive — scarce). */
  expensiveFrac: number;
}

export interface CoverLevelEntry {
  goodId: string;
  /** Median stock / targetStock (days-of-supply cover) across systems. */
  medianCover: number;
  /** Fraction of markets at/above the surplus margin. */
  surplusFrac: number;
  /** Fraction below the deficit fraction. */
  deficitFrac: number;
}

export interface MarketHealthSummary {
  /** Per-good average price standard deviation across systems (high = trade opportunity). */
  priceDispersion: { goodId: string; avgStdDev: number }[];
  /** Per-good average distance of stock from its targetStock at simulation end. */
  stockDrift: { goodId: string; avgStockDrift: number }[];
  /** Per-good fraction of markets clamped at the stock floor / ceiling (supply pathology surface). */
  stockPins: { goodId: string; floorFrac: number; ceilingFrac: number }[];
  /** Galaxy-wide price/base distribution — the floor-pinning signal. */
  priceLevels: PriceLevelSummary;
  /** Per-good stock cover distribution (stock/anchor) — surplus/deficit balance. */
  coverLevels: CoverLevelEntry[];
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
  type: EventTypeId;
  /** Null for region/pair-level events (e.g. relations-owned events). */
  systemId: string | null;
  severity: number;
  startTick: number;
  endTick: number;
  sourceEventId: string | null;
  /** Prices at the event's system when the event started ([] if systemId is null). */
  startPrices: EventBoundaryPrice[];
  /** Prices at the event's system when the event ended ([] if systemId is null). */
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
  systemId: string | null;
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
}

// ── Region overview ─────────────────────────────────────────────

export interface RegionOverviewEntry {
  name: string;
  /** Modal government type across the region's systems, derived from faction ownership. */
  dominantGovernmentType: GovernmentType;
  systemCount: number;
}

// ── Results ─────────────────────────────────────────────────────

export interface SimResults {
  config: SimConfig;
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
  /** Final world state after all ticks (for post-run analysis). */
  finalWorld: World;
  /** Total population summed across all systems at tick 0 (before the loop). */
  initialPopulationTotal: number;
  /** Total building count summed across all systems at tick 0 (before the loop). */
  initialBuildingTotal: number;
  /** Population snapshots sampled at SNAPSHOT_INTERVAL ticks (parallel to marketSnapshots). */
  populationSnapshots: Array<Map<string, number>>;
}
