"use client";

import { useEffect, useState } from "react";
import { useTickContext } from "./use-tick-context";

/**
 * Narrows one `economyTick` broadcast entry enough to read `systemCount` — the field that tells a
 * resolving cycle boundary apart from the mid-cycle broadcast every other tick emits. The economy
 * processor resolves the whole galaxy at once on the cycle's first tick and writes the real system
 * count there (`lib/tick/processors/economy.ts:268-270`); every other tick it emits
 * `economyMidCyclePayload`, which hard-codes `systemCount: 0` (`lib/tick/processors/economy.ts:41`).
 * `subscribeToEvent`'s callback is typed `unknown[]` at its source (`lib/hooks/use-tick.ts:8`), so
 * this is the boundary narrow — `EconomyTickPayload` itself (`lib/tick/types.ts:14`, referenced by
 * `GlobalEventMap.economyTick` at `:32`) is trusted no further downstream.
 */
function hasSystemCount(value: unknown): value is { systemCount: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "systemCount" in value &&
    typeof value.systemCount === "number"
  );
}

/**
 * Count of resolving economy cycles seen this session — advances by one on a cycle boundary tick,
 * never on a mid-cycle `economyTick` broadcast. Session-local: starts at 0 on mount, is not persisted,
 * and neither renders anything nor touches the query cache. `useTickInvalidation` invalidates its
 * queries on every `economyTick` broadcast, mid-cycle included, so "refetches" and "cycles" are
 * different numbers — this hook is the cycle-scoped signal Task 12's chip hysteresis counts through,
 * kept independent of that invalidation traffic on purpose.
 */
export function useCycleBoundary(): number {
  const { subscribeToEvent } = useTickContext();
  const [cycleCount, setCycleCount] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToEvent("economyTick", (events) => {
      const resolved = events.some((event) => hasSystemCount(event) && event.systemCount > 0);
      if (resolved) {
        setCycleCount((count) => count + 1);
      }
    });
    return unsubscribe;
  }, [subscribeToEvent]);

  return cycleCount;
}
