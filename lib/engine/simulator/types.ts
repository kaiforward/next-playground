/**
 * Calibration-harness types — the config it takes, the results it returns, and
 * the market/event/region health shapes its analyzers compute.
 *
 * The tick's own row types live in `lib/tick/rows.ts`; the one world model is
 * `World` (`lib/world/types.ts`) and the one tick pipeline is `runWorldTick`
 * (`lib/world/tick.ts`).
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { GovernmentType } from "@/lib/types/game";
import type { World } from "@/lib/world/types";

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
