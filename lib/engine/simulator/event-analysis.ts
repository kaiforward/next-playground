/**
 * Event impact analysis — post-simulation computation.
 *
 * Tracks event lifecycles during the simulation, then computes impact
 * by comparing earning rates and prices before/during each event.
 */

import { calculatePrice } from "@/lib/engine/pricing";
import type {
  SimWorld,
  SimEvent,
  EventLifecycle,
  EventImpact,
  TickMetrics,
  MarketSnapshot,
} from "./types";

// ── Lifecycle tracking ──────────────────────────────────────────

/**
 * Track event lifecycles by diffing world.events each tick.
 * Call once per tick in the runner loop. Returns lifecycle records
 * for events that expired this tick.
 */
export function trackEventLifecycles(
  world: SimWorld,
  activeEvents: Map<string, { type: string; systemId: string; severity: number; startTick: number; sourceEventId: string | null }>,
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
  activeEvents: Map<string, { type: string; systemId: string; severity: number; startTick: number; sourceEventId: string | null }>,
  endTick: number,
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
    });
  }
  activeEvents.clear();
  return remaining;
}

// ── Impact computation ──────────────────────────────────────────

/**
 * Compute impact metrics for all completed events.
 *
 * - Earning rate: average credits/tick across all players for the window
 *   before the event vs. during the event.
 * - Price impact: compare average prices at the event's system from the
 *   nearest market snapshot before vs. during the event.
 */
export function computeEventImpacts(
  events: EventLifecycle[],
  allMetrics: Map<string, TickMetrics[]>,
  marketSnapshots: { tick: number; markets: MarketSnapshot[] }[],
  systemNames: Map<string, string>,
): EventImpact[] {
  // Skip child/spread events — they're secondary effects, not primary
  const primaryEvents = events.filter((e) => e.sourceEventId === null);
  if (primaryEvents.length === 0) return [];

  // Build a flat earning-rate-per-tick array (sum across all players)
  const playerMetrics = [...allMetrics.values()];
  if (playerMetrics.length === 0) return [];

  const tickCount = playerMetrics[0].length;
  const earningPerTick: number[] = new Array(tickCount).fill(0);
  for (const metrics of playerMetrics) {
    for (let i = 0; i < metrics.length; i++) {
      earningPerTick[i] += metrics[i].tradeProfitSum;
    }
  }
  // Average across players
  const playerCount = playerMetrics.length;
  for (let i = 0; i < earningPerTick.length; i++) {
    earningPerTick[i] /= playerCount;
  }

  const impacts: EventImpact[] = [];

  for (const event of primaryEvents) {
    const duration = event.endTick - event.startTick;
    if (duration <= 0) continue;

    // Earning rate during event (tick indices are 0-based, ticks are 1-based)
    const duringStart = Math.max(0, event.startTick - 1);
    const duringEnd = Math.min(tickCount, event.endTick - 1);
    const duringSlice = earningPerTick.slice(duringStart, duringEnd);
    const duringEventEarningRate = duringSlice.length > 0
      ? duringSlice.reduce((a, b) => a + b, 0) / duringSlice.length
      : 0;

    // Earning rate before event (same-length window before startTick)
    const preStart = Math.max(0, duringStart - duration);
    const preEnd = duringStart;
    const preSlice = earningPerTick.slice(preStart, preEnd);
    const preEventEarningRate = preSlice.length > 0
      ? preSlice.reduce((a, b) => a + b, 0) / preSlice.length
      : 0;

    const earningRateChangePct = preEventEarningRate !== 0
      ? ((duringEventEarningRate - preEventEarningRate) / Math.abs(preEventEarningRate)) * 100
      : 0;

    // Price impact: compare nearest snapshot before event to nearest during event
    const priceImpactPct = computePriceImpact(
      event.systemId,
      event.startTick,
      event.endTick,
      marketSnapshots,
    );

    impacts.push({
      eventId: event.id,
      eventType: event.type,
      systemId: event.systemId,
      systemName: systemNames.get(event.systemId) ?? event.systemId,
      severity: event.severity,
      startTick: event.startTick,
      endTick: event.endTick,
      duration,
      preEventEarningRate,
      duringEventEarningRate,
      earningRateChangePct,
      priceImpactPct,
    });
  }

  // Sort by absolute earning rate change (most impactful first)
  return impacts.sort(
    (a, b) => Math.abs(b.earningRateChangePct) - Math.abs(a.earningRateChangePct),
  );
}

/**
 * Compute average price change at a system between pre-event and during-event snapshots.
 */
function computePriceImpact(
  systemId: string,
  startTick: number,
  endTick: number,
  snapshots: { tick: number; markets: MarketSnapshot[] }[],
): number {
  if (snapshots.length < 2) return 0;

  // Find nearest snapshot before or at startTick
  let preSnap: { tick: number; markets: MarketSnapshot[] } | null = null;
  for (const snap of snapshots) {
    if (snap.tick <= startTick) preSnap = snap;
    else break;
  }

  // Find nearest snapshot during the event
  const midTick = Math.floor((startTick + endTick) / 2);
  let duringSnap: { tick: number; markets: MarketSnapshot[] } | null = null;
  let bestDist = Infinity;
  for (const snap of snapshots) {
    if (snap.tick >= startTick && snap.tick <= endTick) {
      const dist = Math.abs(snap.tick - midTick);
      if (dist < bestDist) {
        duringSnap = snap;
        bestDist = dist;
      }
    }
  }

  if (!preSnap || !duringSnap || preSnap === duringSnap) return 0;

  // Compare average prices for this system
  const prePrices = preSnap.markets.filter((m) => m.systemId === systemId);
  const duringPrices = duringSnap.markets.filter((m) => m.systemId === systemId);

  if (prePrices.length === 0 || duringPrices.length === 0) return 0;

  const preAvg = prePrices.reduce((sum, m) => sum + m.price, 0) / prePrices.length;
  const duringAvg = duringPrices.reduce((sum, m) => sum + m.price, 0) / duringPrices.length;

  if (preAvg === 0) return 0;
  return ((duringAvg - preAvg) / preAvg) * 100;
}
