"use client";

import { useCallback, useEffect, useState } from "react";
import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import type { EconomySnapshotSystem, WorldInspection } from "@/lib/services/dev-tools";

/**
 * Dev tools (build plan Task 13) — dispatches through the same worker command channel every other
 * mutation hook in `lib/hooks/` uses (`lib/runtime/command-client.ts`, Task 8), but does NOT adopt
 * `useCommandMutation`'s `{mutate, mutateAsync, isPending}` surface
 * (`lib/hooks/use-command-mutation.ts`): the dev panel's components
 * (`components/dev-tools/advance-ticks-section.tsx` etc.) read `.data`/`.error.message` too — the
 * old `@tanstack/react-query` `useMutation` shape those components were written against. Widening
 * `useCommandMutation` itself for one dev-only caller would change a production-facing hook's
 * contract for no production benefit, so this file keeps its own small local state instead.
 *
 * The commands dispatched here (`advanceTicks`, `spawnEvent`, `resetEconomy`, `economySnapshot`)
 * only exist in a build where `client/worker/dev-commands.ts` was actually loaded
 * (`import.meta.env.DEV` — see that module's header docstring). Under the old Next/webpack app
 * (still compiling until Task 14), nothing ever calls `configureCommandTransport`, so `sendCommand`
 * resolves `{ok:false, error:"Command transport not configured."}` — the same degrade every other
 * Stage-C mutation hook already accepted (`lib/hooks/use-construction-orders.ts` etc.), not a new
 * failure mode this file introduces.
 */

interface DevMutationState<TData> {
  data: TData | undefined;
  error: Error | undefined;
  isPending: boolean;
}

function useDevMutation<TPayload, TData>(
  send: (payload: TPayload) => Promise<TData>,
): DevMutationState<TData> & { mutate(payload: TPayload): void } {
  const [state, setState] = useState<DevMutationState<TData>>({
    data: undefined,
    error: undefined,
    isPending: false,
  });

  const mutate = useCallback(
    (payload: TPayload) => {
      setState((s) => ({ ...s, isPending: true, error: undefined }));
      send(payload).then(
        (data) => setState({ data, error: undefined, isPending: false }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setState((s) => ({ ...s, error: new Error(message), isPending: false }));
        },
      );
    },
    [send],
  );

  return { ...state, mutate };
}

// ── Economy snapshot query ──────────────────────────────────────

/**
 * Fetches the dev economy snapshot once whenever `enabled` is (or becomes) true. Unlike the old
 * TanStack-backed version, nothing here re-fetches automatically when `resetEconomy`/`advanceTicks`
 * commits — the query-invalidation mechanism those relied on doesn't exist in the command
 * architecture (the worker's post-command state frame only refreshes `SnapshotSlices`, and this
 * dev-only view isn't one). Acceptable for dev tooling; a manual reopen/toggle re-fetches.
 */
export function useEconomySnapshot(enabled: boolean): {
  data: { systems: EconomySnapshotSystem[] } | undefined;
  isLoading: boolean;
} {
  const [data, setData] = useState<{ systems: EconomySnapshotSystem[] } | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    const id = crypto.randomUUID();
    sendCommand({ id, type: "economySnapshot", payload: null }).then((message) => {
      if (cancelled) return;
      setIsLoading(false);
      const result = narrowCommandResult<{ systems: EconomySnapshotSystem[] }>(message.result);
      if (result.ok) setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, isLoading };
}

// ── Mutations ───────────────────────────────────────────────────

export function useAdvanceTicksMutation() {
  return useDevMutation<number, { newTick: number; elapsed: number }>((count) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "advanceTicks", payload: { count } }).then((message) => {
      const result = narrowCommandResult<{ newTick: number; elapsed: number }>(message.result);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    });
  });
}

export function useSpawnEventMutation() {
  return useDevMutation<
    { systemId: string; eventType: string; severity?: number },
    { eventId: string; type: string; phase: string }
  >((payload) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "spawnEvent", payload }).then((message) => {
      const result = narrowCommandResult<{ eventId: string; type: string; phase: string }>(message.result);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    });
  });
}

/**
 * Console-inspection affordance (spec §10, build plan Task 13 review finding 1): `inspectWorld`
 * was protocol-wired with no reachable caller — a developer had to write code to invoke it. This is
 * the minimal honest affordance: a button (`components/dev-tools/advance-ticks-section.tsx`) that
 * dispatches the command and `console.log`s the result, so "Dev inspection of the world... exposing
 * the current snapshot" (spec §10) actually reaches the browser console from the panel.
 */
export function useInspectWorldMutation() {
  return useDevMutation<void, WorldInspection>(() => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "inspectWorld", payload: null }).then((message) => {
      const result = narrowCommandResult<WorldInspection>(message.result);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    });
  });
}

export function useResetEconomyMutation() {
  return useDevMutation<void, { marketsReset: number; eventsCleared: number }>(() => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "resetEconomy", payload: null }).then((message) => {
      const result = narrowCommandResult<{ marketsReset: number; eventsCleared: number }>(message.result);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    });
  });
}
