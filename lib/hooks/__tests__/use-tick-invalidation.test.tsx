import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { makeQueryClient } from "@/lib/query/client";
import { queryKeys } from "@/lib/query/keys";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { SubscribeToEvent } from "@/lib/hooks/use-tick";
import type { GlobalEventMap } from "@/lib/tick/types";

// ── Controllable stand-in for the SSE tick stream ──────────────────
//
// `useTickContext`'s real implementation opens an EventSource, which jsdom can't drive. This
// mock reproduces only the piece under test reads — subscribeToEvent — as a plain listener
// registry the test can push broadcasts through synchronously.
//
// The stand-in is annotated with the REAL `SubscribeToEvent`, so a change to the production
// signature fails here rather than leaving the mock free to accept a subscription the app could
// not make — and each dispatch carries its channel's real payload type, not a bare `{}`.

const { tickContext, resetListeners, dispatch } = vi.hoisted(() => {
  const listeners: { [K in keyof GlobalEventMap]: Set<(events: GlobalEventMap[K]) => void> } = {
    economyTick: new Set(),
    eventNotifications: new Set(),
    shipArrived: new Set(),
  };

  const subscribeToEvent: SubscribeToEvent = function subscribeToEvent<
    K extends keyof GlobalEventMap,
  >(eventName: K, cb: (events: GlobalEventMap[K]) => void) {
    listeners[eventName].add(cb);
    return () => {
      listeners[eventName].delete(cb);
    };
  };

  function dispatch<K extends keyof GlobalEventMap>(eventName: K, events: GlobalEventMap[K]) {
    for (const cb of listeners[eventName]) cb(events);
  }

  return {
    tickContext: { subscribeToEvent },
    resetListeners: () => {
      for (const set of Object.values(listeners)) set.clear();
    },
    dispatch,
  };
});

vi.mock("@/lib/hooks/use-tick-context", () => ({
  useTickContext: () => tickContext,
}));

beforeEach(() => {
  resetListeners();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `useAlerts` no longer touches TanStack at all (client-runtime build plan Task 8 — it reads the
 * store's `alerts` slice directly, fed by the worker's own state frames, not query invalidation), so
 * the "mount alongside the real hook" coupling this suite used to rely on no longer exists to
 * couple against: there is no real hook left reading `queryKeys.alerts` for this test to reuse. A
 * hand-rolled probe query on the SAME key `use-tick-invalidation.ts` invalidates is what remains —
 * this file is itself an inert-pending-Task-14 module now (nothing subscribes to `queryKeys.alerts`
 * in production either), so this suite only proves the invalidation call itself still fires on each
 * channel, which is what keeps `use-tick-invalidation.ts` compiling and behaviourally unchanged
 * until its Task 14 deletion.
 */
function AlertCountProbe() {
  const { data } = useQuery({
    queryKey: queryKeys.alerts,
    queryFn: () => fetch("/api/game/player/alerts").then((r) => r.json()),
  });
  return <div data-testid="alert-count">{data ? "loaded" : "loading"}</div>;
}

function AlertsProbe() {
  useTickInvalidation();
  return <AlertCountProbe />;
}

/** A fresh Response per call — a single shared one has its body consumed after the first read. */
function stubAlertFetch() {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { categories: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useTickInvalidation — the alerts query key (module now inert pending Task 14 deletion)", () => {
  it("refetches the probe query on an economyTick broadcast", async () => {
    const queryClient = makeQueryClient();
    const fetchMock = stubAlertFetch();

    render(
      <QueryClientProvider client={queryClient}>
        <AlertsProbe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      // A real boundary-tick payload: the handler ignores its contents, but the channel's type is
      // what pins the subscription to the economy channel rather than any string.
      dispatch("economyTick", [{ systemCount: 12, shardIndex: 0, shardCount: CYCLE_LENGTH }]);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("refetches the probe query on an eventNotifications broadcast", async () => {
    const queryClient = makeQueryClient();
    const fetchMock = stubAlertFetch();

    render(
      <QueryClientProvider client={queryClient}>
        <AlertsProbe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      dispatch("eventNotifications", [{ message: "Plague outbreak", type: "plague", refs: {} }]);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
