"use client";

import { useState } from "react";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { useTickContext } from "./use-tick-context";

/**
 * Count of resolving economy cycles seen this session — 0 on mount, advancing by one for each cycle
 * boundary the world has crossed since. Session-local: not persisted, and this neither renders
 * anything nor touches the query cache. `useTickInvalidation` invalidates its queries on every
 * `economyTick` broadcast, mid-cycle included, so "refetches" and "cycles" are different numbers —
 * this is the cycle-scoped signal, kept independent of that invalidation traffic on purpose.
 *
 * Derived from the monotonic tick, NOT by counting boundary broadcasts. The transport is lossy by
 * design: the tick loop throttles its frames to one per 250 ms and is latest-wins, replacing the
 * pending frame rather than merging its `events` (`lib/world/tick-loop.ts`), while the boundary
 * payload is emitted by one tick in twenty-four (`lib/tick/processors/economy.ts`). At speed an
 * entire cycle — boundary frame included — can therefore vanish inside one throttle window, and an
 * edge-counting hook would silently stall. `currentTick` survives that: it is overwritten by every
 * frame that does arrive, so it is correct however many were dropped, and the floor division below
 * turns "which cycle is the world in" into a count that cannot miss one.
 *
 * The anchor is the first tick the transport actually reports, not the first render: `useTick` opens
 * at 0 and seeds from REST in an effect, so a pre-connection 0 would anchor a live world at cycle 0
 * and hand the first real frame a session count in the hundreds. Waiting for a positive tick costs
 * nothing on a genuinely new world, whose first reported tick is in the same cycle 0 the anchor
 * would have been. A world REPLACED under a mounted hook (New game) rewinds the tick behind the
 * anchor; the clamp reports 0 rather than a negative count until it passes the anchor again.
 *
 * It is taken during render, not from an effect: the anchor is derived from the very `currentTick`
 * this render already has, so an effect would only re-run the render a second time to learn what the
 * first one could already see (the cascading-render cost React's own "you might not need an effect"
 * guidance is about). The write is React's adjust-state-during-render idiom — guarded, taken at most
 * once per session, and idempotent, since the anchor it stores is a pure function of this render's
 * input. Neither render can report anything but 0 anyway: the anchor IS that render's own cycle.
 *
 * `CYCLE_LENGTH` is the live loop's own economy cadence. A `runWorldTick` called with a cadence
 * override (dev and test surfaces only) would resolve on a different rhythm than this counts.
 */
export function useCycleBoundary(): number {
  const { currentTick } = useTickContext();
  const [anchorCycle, setAnchorCycle] = useState<number | null>(null);
  const cycle = Math.floor(currentTick / CYCLE_LENGTH);

  if (anchorCycle === null && currentTick > 0) setAnchorCycle(cycle);

  return anchorCycle === null ? 0 : Math.max(0, cycle - anchorCycle);
}
