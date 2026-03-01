/**
 * Event impact analysis — post-simulation computation.
 *
 * Tracks event lifecycles during the simulation (capturing market prices
 * at event boundaries), then computes per-good price impact and
 * system-local bot activity for each event.
 */

import type { EventTypeId } from "@/lib/constants/events";
import { calculatePrice } from "@/lib/engine/pricing";
import type {
  SimWorld,
  SimMarketEntry,
  EventLifecycle,
  EventBoundaryPrice,
  EventImpact,
  GoodPriceChange,
  TickMetrics,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────

/** Snapshot current prices at a system from a markets array. */
function snapshotPrices(
  markets: SimMarketEntry[],
  systemId: string,
): EventBoundaryPrice[] {
  return markets
    .filter((m) => m.systemId === systemId)
    .map((m) => ({
      goodId: m.goodId,
      price: calculatePrice(m.basePrice, m.supply, m.demand, m.priceFloor, m.priceCeiling),
    }));
}

// ── Active event record (internal) ──────────────────────────────

interface ActiveEventRecord {
  type: EventTypeId;
  systemId: string;
  severity: number;
  startTick: number;
  sourceEventId: string | null;
  startPrices: EventBoundaryPrice[];
}

// ── Lifecycle tracking ──────────────────────────────────────────

/**
 * Track event lifecycles by diffing world.events each tick.
 * Call once per tick in the runner loop. Returns lifecycle records
 * for events that expired this tick.
 *
 * @param preTickMarkets - the markets array from BEFORE the current tick
 *   (used to capture start prices for newly-detected events)
 */
export function trackEventLifecycles(
  world: SimWorld,
  activeEvents: Map<string, ActiveEventRecord>,
  preTickMarkets: SimMarketEntry[],
): EventLifecycle[] {
  const completed: EventLifecycle[] = [];
  const currentIds = new Set(world.events.map((e) => e.id));

  // Detect newly appeared events
  for (const event of world.events) {
    if (!activeEvents.has(event.id)) {
      activeEvents.set(event.id, {
        type: event.type,
        systemId: event.systemId,
        severity: event.severity,
        startTick: event.startTick,
        sourceEventId: event.sourceEventId,
        startPrices: snapshotPrices(preTickMarkets, event.systemId),
      });
    }
  }

  // Detect expired events (were active, no longer in world.events)
  for (const [id, info] of activeEvents) {
    if (!currentIds.has(id)) {
      completed.push({
        id,
        type: info.type,
        systemId: info.systemId,
        severity: info.severity,
        startTick: info.startTick,
        endTick: world.tick,
        sourceEventId: info.sourceEventId,
        startPrices: info.startPrices,
        endPrices: snapshotPrices(world.markets, info.systemId),
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
  finalMarkets: SimMarketEntry[],
): EventLifecycle[] {
  const remaining: EventLifecycle[] = [];
  for (const [id, info] of activeEvents) {
    remaining.push({
      id,
      type: info.type,
      systemId: info.systemId,
      severity: info.severity,
      startTick: info.startTick,
      endTick: endTick,
      sourceEventId: info.sourceEventId,
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
 * - System-local bot activity (visits, trades, profit) during the event
 */
export function computeEventImpacts(
  events: EventLifecycle[],
  allMetrics: Map<string, TickMetrics[]>,
  systemNames: Map<string, string>,
): EventImpact[] {
  if (events.length === 0) return [];

  // Build a lookup from event id → type for resolving parent types
  const eventTypeById = new Map(events.map((e) => [e.id, e.type]));

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

    // System-local bot activity during event window
    const { botVisits, tradeCount, tradeProfit } = computeSystemActivity(
      event.systemId,
      event.startTick,
      event.endTick,
      allMetrics,
    );

    // Resolve parent event type (null for root events)
    const parentEventType = event.sourceEventId
      ? (eventTypeById.get(event.sourceEventId) ?? null)
      : null;

    impacts.push({
      eventId: event.id,
      eventType: event.type,
      systemId: event.systemId,
      systemName: systemNames.get(event.systemId) ?? event.systemId,
      severity: event.severity,
      startTick: event.startTick,
      endTick: event.endTick,
      duration,
      parentEventType,
      goodPriceChanges,
      weightedPriceImpactPct,
      botVisitsDuring: botVisits,
      tradeCountDuring: tradeCount,
      tradeProfitDuring: tradeProfit,
    });
  }

  // Sort: root events by abs(weightedPriceImpactPct) desc,
  // child events grouped after their parent by same sort
  return sortImpactsWithChildren(impacts);
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

/**
 * Count bot activity at a specific system during an event window.
 */
function computeSystemActivity(
  systemId: string,
  startTick: number,
  endTick: number,
  allMetrics: Map<string, TickMetrics[]>,
): { botVisits: number; tradeCount: number; tradeProfit: number } {
  let botVisits = 0;
  let tradeCount = 0;
  let tradeProfit = 0;

  for (const metrics of allMetrics.values()) {
    // Tick indices are 0-based, ticks are 1-based
    const iStart = Math.max(0, startTick - 1);
    const iEnd = Math.min(metrics.length, endTick - 1);

    for (let i = iStart; i < iEnd; i++) {
      const m = metrics[i];
      if (m.systemVisited === systemId) {
        botVisits++;
        tradeCount += m.tradeCount;
        tradeProfit += m.tradeProfitSum;
      }
    }
  }

  return { botVisits, tradeCount, tradeProfit };
}

/**
 * Sort impacts: root events by abs(weightedPriceImpactPct) desc,
 * child events grouped immediately after their parent by same sort.
 */
function sortImpactsWithChildren(impacts: EventImpact[]): EventImpact[] {
  const roots = impacts.filter((e) => e.parentEventType === null);
  const children = impacts.filter((e) => e.parentEventType !== null);

  // Sort roots by absolute weighted price impact
  roots.sort((a, b) => Math.abs(b.weightedPriceImpactPct) - Math.abs(a.weightedPriceImpactPct));

  // Group children by parent event id
  const childrenByParent = new Map<string, EventImpact[]>();
  for (const child of children) {
    // Find parent: the root event whose id matches child's sourceEventId from the lifecycle
    // We need to find the parent by looking at the original event's sourceEventId
    // Since parentEventType is derived from sourceEventId, we need to match by event relationship
    // The child's eventId's sourceEventId maps to a parent event
    // But we only have parentEventType — find the root event at the same or nearby system
    // Actually, we stored sourceEventId in lifecycle, but EventImpact doesn't have it.
    // We'll just group orphan children at the end, sorted by impact.
    const parentId = findParentEventId(child, roots);
    if (parentId) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(child);
      childrenByParent.set(parentId, list);
    } else {
      // Orphan child — append at end
      const list = childrenByParent.get("__orphan__") ?? [];
      list.push(child);
      childrenByParent.set("__orphan__", list);
    }
  }

  // Sort each child group
  for (const group of childrenByParent.values()) {
    group.sort((a, b) => Math.abs(b.weightedPriceImpactPct) - Math.abs(a.weightedPriceImpactPct));
  }

  // Interleave: root, then its children
  const result: EventImpact[] = [];
  for (const root of roots) {
    result.push(root);
    const kids = childrenByParent.get(root.eventId);
    if (kids) result.push(...kids);
  }

  // Append orphan children
  const orphans = childrenByParent.get("__orphan__");
  if (orphans) result.push(...orphans);

  return result;
}

/**
 * Find the most likely parent root event for a child event.
 * Match by: parentEventType matches root's eventType AND overlapping tick ranges.
 */
function findParentEventId(child: EventImpact, roots: EventImpact[]): string | null {
  // Find roots whose type matches the child's parentEventType
  // and whose tick range overlaps with the child's
  const candidates = roots.filter((r) =>
    r.eventType === child.parentEventType &&
    r.startTick <= child.startTick &&
    r.endTick >= child.startTick,
  );

  if (candidates.length === 0) return null;

  // If multiple, pick the one with the closest start tick
  candidates.sort((a, b) =>
    Math.abs(a.startTick - child.startTick) - Math.abs(b.startTick - child.startTick),
  );
  return candidates[0].eventId;
}
