import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { makeQueryClient } from "@/lib/query/client";
import { queryKeys } from "@/lib/query/keys";

// ── Controllable stand-in for the SSE tick stream ──────────────────
//
// `useTickContext`'s real implementation opens an EventSource, which jsdom can't drive. This
// mock reproduces only the piece under test reads — subscribeToEvent — as a plain listener
// registry the test can push broadcasts through synchronously. Mirrors
// lib/hooks/__tests__/use-cycle-boundary.test.tsx's own mock.

const { listeners, dispatch } = vi.hoisted(() => {
  const map = new Map<string, Set<(events: unknown[]) => void>>();
  return {
    listeners: map,
    dispatch: (eventName: string) => {
      const subs = map.get(eventName);
      if (!subs) return;
      for (const cb of subs) cb([{}]);
    },
  };
});

vi.mock("@/lib/hooks/use-tick-context", () => ({
  useTickContext: () => ({
    subscribeToEvent: (eventName: string, cb: (events: unknown[]) => void) => {
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

/** Mounts useTickInvalidation alongside a probe query on queryKeys.alerts, so a test can assert
 *  on the probe's fetch count without touching the real alert-bar fetch/hook. */
function AlertsProbe({ queryFn }: { queryFn: () => Promise<{ categories: [] }> }) {
  useTickInvalidation();
  useQuery({ queryKey: queryKeys.alerts, queryFn });
  return null;
}

describe("useTickInvalidation — the alert bar's key", () => {
  it("invalidates queryKeys.alerts on an economyTick broadcast", async () => {
    const queryClient = makeQueryClient();
    const queryFn = vi.fn().mockResolvedValue({ categories: [] });

    render(
      <QueryClientProvider client={queryClient}>
        <AlertsProbe queryFn={queryFn} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await act(async () => {
      dispatch("economyTick");
    });

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });

  it("invalidates queryKeys.alerts on an eventNotifications broadcast", async () => {
    const queryClient = makeQueryClient();
    const queryFn = vi.fn().mockResolvedValue({ categories: [] });

    render(
      <QueryClientProvider client={queryClient}>
        <AlertsProbe queryFn={queryFn} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    await act(async () => {
      dispatch("eventNotifications");
    });

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
