"use client";

import { useSyncExternalStore } from "react";
import { gameStore } from "./use-game-store";

/**
 * The client-runtime "in-flight rule" (build plan Task 8, spec §2 "Commands"): a control holds its
 * just-committed value until the store's next frame lands, so a rapid second command reads the
 * first's committed value rather than a stale pre-commit snapshot — the replacement for the four
 * `setQueryData` sites the query-layer census found (C4: `use-faction-treasury.ts:29-37`; siblings
 * `use-player-pins.ts:20-22`, `use-player-settings.ts:25-27,40-42`).
 *
 * One overlay store per mutated record, keyed by whatever identifies "which record" — a faction id
 * for treasury policy, or the module's own `GLOBAL_KEY` for the three player-scoped records (pins,
 * alert categories, tracker sections), which carry no id of their own. A domain hook writes the
 * overlay in its command's success handler (the committed data the result already carries — no
 * read-back needed, the mutation services already return the full post-write record) and schedules
 * `clearOnNextFrame` right after, so the overlay is visible for exactly the window between "this
 * command resolved" and "the store observed ANY next frame" — which, because the worker always
 * pushes a fresh state frame immediately after every command result
 * (`client/worker/game-worker.ts`'s `handleCommand`), is always the frame that command itself
 * committed.
 */
export interface OverlayStore<T> {
  set(key: string, value: T): void;
  clear(key: string): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(key: string): T | undefined;
}

export function createOverlayStore<T>(): OverlayStore<T> {
  const values = new Map<string, T>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    set(key, value) {
      values.set(key, value);
      notify();
    },
    clear(key) {
      if (values.delete(key)) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(key) {
      return values.get(key);
    },
  };
}

/** Reads one overlay entry, re-rendering the calling component whenever it's set or cleared. */
export function useOverlay<T>(store: OverlayStore<T>, key: string): T | undefined {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot(key));
}

/** Clears `key` the moment the game store observes its next applied frame (any frame — see the
 *  module docstring for why "next" is always "this command's own"). Call right after `store.set`. */
export function clearOnNextFrame<T>(store: OverlayStore<T>, key: string): void {
  const unsubscribe = gameStore.subscribe(() => {
    unsubscribe();
    store.clear(key);
  });
}
