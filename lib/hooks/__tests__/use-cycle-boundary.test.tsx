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
import type { EconomyTickPayload, GlobalEventMap } from "@/lib/tick/types";
import type { SubscribeToEvent } from "@/lib/hooks/use-tick";

// ── Controllable stand-in for the SSE tick stream ──────────────────
//
// `useTickContext`'s real implementation opens an EventSource, which jsdom can't drive. This mock
// reproduces the two pieces the hooks under test read: `currentTick`, the monotonic tick every
// surviving frame overwrites, and `subscribeToEvent`, a plain listener registry the test can push
// broadcasts through synchronously. They are driven SEPARATELY on purpose — the transport really can
// deliver a tick number without the boundary broadcast that belongs to it, which is the whole reason
// the hook counts the former rather than the latter.

const { transport, dispatchEconomyTick } = vi.hoisted(() => {
  const listeners: { [K in keyof GlobalEventMap]: Set<(events: GlobalEventMap[K]) => void> } = {
    economyTick: new Set(),
    eventNotifications: new Set(),
    shipArrived: new Set(),
  };

  // Annotated with the REAL `SubscribeToEvent`: a change to the production signature fails here
  // rather than leaving the stand-in free to accept a subscription the app could not make.
  const subscribeToEvent: SubscribeToEvent = function subscribeToEvent<
    K extends keyof GlobalEventMap,
  >(eventName: K, cb: (events: GlobalEventMap[K]) => void) {
    listeners[eventName].add(cb);
    return () => {
      listeners[eventName].delete(cb);
    };
  };

  return {
    transport: {
      currentTick: 0,
      subscribeToEvent,
      reset: () => {
        for (const set of Object.values(listeners)) set.clear();
      },
    },
    dispatchEconomyTick: (payload: EconomyTickPayload) => {
      for (const cb of listeners.economyTick) cb([payload]);
    },
  };
});

vi.mock("@/lib/hooks/use-tick-context", () => ({
  useTickContext: () => ({
    currentTick: transport.currentTick,
    subscribeToEvent: transport.subscribeToEvent,
  }),
}));

beforeEach(() => {
  transport.reset();
  transport.currentTick = 0;
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

/** One surviving transport frame: the tick it carried, rendered. */
function deliverTick(tick: number, rerender: (ui: React.ReactElement) => void): void {
  act(() => {
    transport.currentTick = tick;
  });
  rerender(<CycleCountProbe />);
}

const reading = (): string => screen.getByTestId("cycle-count").textContent ?? "";

describe("useCycleBoundary — a mid-cycle tick does not advance the count; crossing a boundary does", () => {
  it("stays at 0 through mid-cycle ticks and advances to 1 at the cycle boundary tick", () => {
    const { rerender } = render(<CycleCountProbe />);
    expect(reading()).toBe("0");

    deliverTick(1, rerender);
    deliverTick(2, rerender);
    expect(reading()).toBe("0");

    deliverTick(CYCLE_LENGTH, rerender); // tick 24: the cycle boundary
    expect(reading()).toBe("1");
  });
});

describe("useCycleBoundary — the count is not a count of frames", () => {
  it("advances by the cycles actually crossed when the transport drops whole cycles of frames", () => {
    // The tick loop throttles broadcasts to one per 250 ms, latest-wins, replacing the pending frame
    // rather than merging its events — so at speed a whole cycle, boundary payload included, can
    // vanish between two frames that do arrive. Three frames here span three cycle boundaries, and
    // the count has to read 3: anything derived from the frames themselves would read 1.
    const { rerender } = render(<CycleCountProbe />);
    deliverTick(1, rerender);
    expect(reading()).toBe("0");

    deliverTick(CYCLE_LENGTH * 3, rerender); // ticks 2..71 never arrived
    expect(reading()).toBe("3");

    deliverTick(CYCLE_LENGTH * 4 + 5, rerender); // and it keeps counting from there
    expect(reading()).toBe("4");
  });

  it("starts at 0 when it mounts against a world already thousands of ticks in", () => {
    // `useTick` opens at 0 and seeds the real tick from REST in an effect, so the first render of a
    // live world always sees the placeholder. Anchoring on that would hand the first real frame a
    // session count of hundreds; the count means cycles seen THIS session.
    const { rerender } = render(<CycleCountProbe />);
    deliverTick(5000, rerender);
    expect(reading()).toBe("0");

    deliverTick(5000 + CYCLE_LENGTH, rerender);
    expect(reading()).toBe("1");
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

    // A FRESH element each time: React bails out of re-rendering an identical element reference,
    // which would silently freeze the probe at its first tick.
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
    const { rerender } = render(tree());

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("market-rows")).toHaveTextContent("1"));

    // Tick 1 first, so the session anchor is taken before the boundary under test.
    await act(async () => {
      transport.currentTick = 1;
      dispatchEconomyTick(payloadForTick(1, 12));
    });
    rerender(tree());

    await act(async () => {
      transport.currentTick = CYCLE_LENGTH;
      dispatchEconomyTick(payloadForTick(CYCLE_LENGTH, 12));
    });
    rerender(tree());

    // useTickInvalidation's invalidation on these broadcasts really refetched the market query, and
    // the refetch really returned the identical fixture...
    await waitFor(() => expect(queryFn.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId("market-rows")).toHaveTextContent("1");
    // ...none of which cost the cycle count anything: still exactly one advance for the one boundary
    // the world crossed, however many refetches it triggered.
    expect(reading()).toBe("1");
  });
});

describe("useCycleBoundary — a component consuming it sees exactly one advance per cycle across a multi-tick run", () => {
  it("advances 0→1→2→3 across three full CYCLE_LENGTH-tick cycles, and nowhere else", () => {
    const { rerender } = render(<CycleCountProbe />);

    const readingsByTick: string[] = [];
    for (let tick = 1; tick <= CYCLE_LENGTH * 3; tick++) {
      deliverTick(tick, rerender);
      readingsByTick.push(reading());
    }

    expect(readingsByTick[CYCLE_LENGTH - 1]).toBe("1"); // tick 24
    expect(readingsByTick[CYCLE_LENGTH * 2 - 1]).toBe("2"); // tick 48
    expect(readingsByTick[CYCLE_LENGTH * 3 - 1]).toBe("3"); // tick 72

    // The count changes exactly three times across the whole 72-tick run, always by one.
    const transitions = readingsByTick.filter((value, i) => i === 0 || value !== readingsByTick[i - 1]);
    expect(transitions).toEqual(["0", "1", "2", "3"]);
  });
});
