import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCycleBoundary } from "@/lib/hooks/use-cycle-boundary";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { makeQueryClient } from "@/lib/query/client";
import { queryKeys } from "@/lib/query/keys";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { isCycleStart } from "@/lib/tick/shard";
import { economyMidCyclePayload } from "@/lib/tick/processors/economy";
import type { EconomyTickPayload } from "@/lib/tick/types";

// ── Controllable stand-in for the SSE tick stream ──────────────────
//
// `useTickContext`'s real implementation opens an EventSource, which jsdom can't drive. This
// mock reproduces only the piece both hooks under test read — subscribeToEvent — as a plain
// listener registry the test can push broadcasts through synchronously.

const { listeners, dispatchEconomyTick } = vi.hoisted(() => {
  const map = new Map<string, Set<(events: EconomyTickPayload[]) => void>>();
  return {
    listeners: map,
    dispatchEconomyTick: (payload: EconomyTickPayload) => {
      const subs = map.get("economyTick");
      if (!subs) return;
      for (const cb of subs) cb([payload]);
    },
  };
});

vi.mock("@/lib/hooks/use-tick-context", () => ({
  useTickContext: () => ({
    subscribeToEvent: (eventName: string, cb: (events: EconomyTickPayload[]) => void) => {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName)?.add(cb);
      return () => {
        listeners.get(eventName)?.delete(cb);
      };
    },
  }),
}));

beforeEach(() => {
  listeners.clear();
});

/**
 * The real broadcast shape for one tick. Mid-cycle ticks come straight from the processor's own
 * exported `economyMidCyclePayload` — not a hand-rolled `{ systemCount: 0 }` literal — so the
 * fixture tracks the production mid-cycle shape if it ever changes. `resolvedSystemCount` stands
 * in for whatever the shard actually visited on a boundary tick; only its sign (>0) matters here.
 */
function payloadForTick(tick: number, resolvedSystemCount: number): EconomyTickPayload {
  if (!isCycleStart(tick, CYCLE_LENGTH)) {
    const mid = economyMidCyclePayload(tick, CYCLE_LENGTH);
    const entry = mid.economyTick?.[0];
    if (!entry) throw new Error("economyMidCyclePayload emitted no economyTick entry");
    return entry;
  }
  return { systemCount: resolvedSystemCount, shardIndex: 0, shardCount: CYCLE_LENGTH };
}

function CycleCountProbe() {
  const count = useCycleBoundary();
  return <div data-testid="cycle-count">{count}</div>;
}

describe("useCycleBoundary — a mid-cycle economy tick does not advance the count; a resolving one does", () => {
  it("stays at 0 through mid-cycle ticks and advances to 1 on the cycle boundary tick", () => {
    render(<CycleCountProbe />);
    expect(screen.getByTestId("cycle-count")).toHaveTextContent("0");

    act(() => {
      dispatchEconomyTick(payloadForTick(1, 12));
      dispatchEconomyTick(payloadForTick(2, 12));
    });
    expect(screen.getByTestId("cycle-count")).toHaveTextContent("0");

    act(() => {
      dispatchEconomyTick(payloadForTick(CYCLE_LENGTH, 12)); // tick 24: the cycle boundary
    });
    expect(screen.getByTestId("cycle-count")).toHaveTextContent("1");
  });
});

describe("useCycleBoundary — the count survives a refetch that returns identical data", () => {
  it("a boundary tick that also fires useTickInvalidation's refetch still advances the count by exactly one", async () => {
    const queryClient = makeQueryClient();
    const marketFixture = [{ systemId: "sys-1", goodId: "food", stock: 10 }];
    const queryFn = vi.fn().mockResolvedValue(marketFixture);

    function Probe() {
      useTickInvalidation();
      const count = useCycleBoundary();
      const { data } = useQuery({ queryKey: queryKeys.marketAll, queryFn });
      return (
        <div>
          <div data-testid="cycle-count">{count}</div>
          <div data-testid="market-rows">{data?.length ?? 0}</div>
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("market-rows")).toHaveTextContent("1"));

    await act(async () => {
      dispatchEconomyTick(payloadForTick(CYCLE_LENGTH, 12));
    });

    // useTickInvalidation's invalidation on this same broadcast really refetched the market
    // query, and the refetch really returned the identical fixture...
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("market-rows")).toHaveTextContent("1");
    // ...none of which cost the cycle count anything: still exactly one advance for the one
    // boundary broadcast that caused both.
    expect(screen.getByTestId("cycle-count")).toHaveTextContent("1");
  });
});

describe("useCycleBoundary — a component consuming it sees exactly one advance per cycle across a multi-tick run", () => {
  it("advances 0→1→2→3 across three full CYCLE_LENGTH-tick cycles, and nowhere else", () => {
    render(<CycleCountProbe />);

    const readingsByTick: string[] = [];
    for (let tick = 1; tick <= CYCLE_LENGTH * 3; tick++) {
      act(() => {
        dispatchEconomyTick(payloadForTick(tick, 9));
      });
      readingsByTick.push(screen.getByTestId("cycle-count").textContent ?? "");
    }

    expect(readingsByTick[CYCLE_LENGTH - 1]).toBe("1"); // tick 24
    expect(readingsByTick[CYCLE_LENGTH * 2 - 1]).toBe("2"); // tick 48
    expect(readingsByTick[CYCLE_LENGTH * 3 - 1]).toBe("3"); // tick 72

    // The count changes exactly three times across the whole 72-tick run, always by one.
    const transitions = readingsByTick.filter((value, i) => i === 0 || value !== readingsByTick[i - 1]);
    expect(transitions).toEqual(["0", "1", "2", "3"]);
  });
});
