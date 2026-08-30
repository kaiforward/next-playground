/**
 * Event impact analysis — post-simulation computation.
 *
 * Tracks event lifecycles during the simulation (capturing market prices
 * at event boundaries), then computes per-good price impact and
 * system-local bot activity for each event.
 */

import type { EventTypeId } from "@/lib/constants/events";
import { spotPrice, curveForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import type {
  EventLifecycle,
  EventBoundaryPrice,
  EventImpact,
  GoodPriceChange,
} from "./types";
import type { TickEvent } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";

// ── Helpers ──────────────────────────────────────────────────────

/** Snapshot current prices at a system from a markets array ([] for region/pair-level events with no system). */
function snapshotPrices(
  markets: WorldMarket[],
  systemId: string | null,
): EventBoundaryPrice[] {
  if (systemId === null) return [];
  return markets
    .filter((m) => m.systemId === systemId)
    .map((m) => ({
      goodId: m.goodId,
      price: spotPrice(curveForRow(m, GOODS[m.goodId]), m.stock),
    }));
}

// ── Active event record (internal) ──────────────────────────────

interface ActiveEventRecord {
  type: EventTypeId;
  systemId: string | null;
  startTick: number;
  startPrices: EventBoundaryPrice[];
}

// ── Lifecycle tracking ──────────────────────────────────────────

/**
 * Track event lifecycles by diffing the current tick's events against the
 * active set. Call once per tick in the runner loop. Returns lifecycle
 * records for events that expired this tick.
 *
 * @param preTickMarkets - the markets array from BEFORE the current tick
 *   (used to capture start prices for newly-detected events)
 */
export function trackEventLifecycles(
  events: TickEvent[],
  markets: WorldMarket[],
  tick: number,
  activeEvents: Map<string, ActiveEventRecord>,
  preTickMarkets: WorldMarket[],
): EventLifecycle[] {
  const completed: EventLifecycle[] = [];
  const currentIds = new Set(events.map((e) => e.id));

  // Detect newly appeared events
  for (const event of events) {
    if (!activeEvents.has(event.id)) {
      activeEvents.set(event.id, {
        type: event.type,
        systemId: event.systemId,
        startTick: event.startTick,
        startPrices: snapshotPrices(preTickMarkets, event.systemId),
      });
    }
  }

  // Detect expired events (were active, no longer present)
  for (const [id, info] of activeEvents) {
    if (!currentIds.has(id)) {
      completed.push({
        id,
        type: info.type,
        systemId: info.systemId,
        startTick: info.startTick,
        endTick: tick,
        startPrices: info.startPrices,
        endPrices: snapshotPrices(markets, info.systemId),
      });
      activeEvents.delete(id);
    }
  }

  return completed;
}

/**
 * Flush any still-active events at simulation end.
 */
export function flushActiveEvents(
  activeEvents: Map<string, ActiveEventRecord>,
  endTick: number,
  finalMarkets: WorldMarket[],
): EventLifecycle[] {
  const remaining: EventLifecycle[] = [];
  for (const [id, info] of activeEvents) {
    remaining.push({
      id,
      type: info.type,
      systemId: info.systemId,
      startTick: info.startTick,
      endTick: endTick,
      startPrices: info.startPrices,
      endPrices: snapshotPrices(finalMarkets, info.systemId),
    });
  }
  activeEvents.clear();
  return remaining;
}

// ── Impact computation ──────────────────────────────────────────

/**
 * Compute impact metrics for all completed events (including child events).
 *
 * - Per-good price changes from lifecycle boundary prices
 * - Base-price-weighted average price change
 */
export function computeEventImpacts(
  events: EventLifecycle[],
  systemNames: Map<string, string>,
): EventImpact[] {
  if (events.length === 0) return [];

  const impacts: EventImpact[] = [];

  for (const event of events) {
    const duration = event.endTick - event.startTick;
    if (duration <= 0) continue;

    // Per-good price changes from boundary snapshots
    const goodPriceChanges = computeGoodPriceChanges(
      event.startPrices,
      event.endPrices,
    );

    // Base-price-weighted average
    const weightedPriceImpactPct = computeWeightedPriceImpact(goodPriceChanges);

    impacts.push({
      eventId: event.id,
      eventType: event.type,
      systemId: event.systemId,
      systemName: event.systemId ? (systemNames.get(event.systemId) ?? event.systemId) : "—",
      startTick: event.startTick,
      endTick: event.endTick,
      duration,
      goodPriceChanges,
      weightedPriceImpactPct,
    });
  }

  return impacts.sort(
    (a, b) => Math.abs(b.weightedPriceImpactPct) - Math.abs(a.weightedPriceImpactPct),
  );
}

/**
 * Compute per-good price changes between start and end boundary snapshots.
 */
function computeGoodPriceChanges(
  startPrices: EventBoundaryPrice[],
  endPrices: EventBoundaryPrice[],
): GoodPriceChange[] {
  const endMap = new Map(endPrices.map((p) => [p.goodId, p.price]));
  const changes: GoodPriceChange[] = [];

  for (const start of startPrices) {
    const endPrice = endMap.get(start.goodId);
    if (endPrice === undefined) continue;

    const changePct = start.price !== 0
      ? ((endPrice - start.price) / start.price) * 100
      : 0;

    changes.push({
      goodId: start.goodId,
      priceBefore: start.price,
      priceAfter: endPrice,
      changePct,
    });
  }

  return changes;
}

/**
 * Compute base-price-weighted average price change.
 * Weights each good's change by its basePrice so that expensive goods
 * contribute proportionally more to the aggregate.
 */
function computeWeightedPriceImpact(changes: GoodPriceChange[]): number {
  if (changes.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const c of changes) {
    // Use priceBefore as weight (approximates basePrice × multiplier)
    const weight = c.priceBefore;
    weightedSum += c.changePct * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
