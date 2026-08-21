"use client";

/**
 * The UI-side interest registry (frame-architecture spec, "Interest protocol") — the client half of
 * the interest set the worker holds (`client/worker/game-worker.ts`'s `currentInterest`,
 * `lib/runtime/channel.ts`'s `InterestSet`). Ref-counted per (kind, id) because more than one
 * consumer can want the same id open at once (e.g. a route panel and a popover both showing the same
 * system) — the id only leaves the posted set once every registrant has released it. Posts the
 * replace-whole-set on every NET change (an id entering or leaving the posted set), never on a
 * no-op registration/release that leaves the set unchanged (no post storm on re-render).
 *
 * Pure and worker-agnostic by construction — `createInterestRegistry` takes a `post` callback rather
 * than importing the worker connection or the store, so it is testable with a recording fn. The one
 * real instance is bound in `client/main.tsx` (which owns the real `Worker`) via
 * `bindInterestRegistry`; `useInterest` below reads that module-level instance rather than requiring
 * every panel to thread a registry prop through.
 */
import { useEffect } from "react";
import type { InterestSet } from "@/lib/runtime/channel";

export type InterestKind = "system" | "good";

export interface InterestRegistry {
  /**
   * Ref-counts (kind, id) and returns the release function. Calling `register` for an
   * already-held (kind, id) increments the count without posting — the posted set doesn't change
   * until every registrant of that id has released it.
   */
  register(kind: InterestKind, id: string): () => void;
  /**
   * Re-posts the currently-held set verbatim, unconditionally (never gated by the change check
   * `register`/release use) — the re-post-after-replacement clause: a worker world swap clears the
   * WORKER's held interest, so the shell must re-announce the UI's still-open panels even though
   * the UI-side set itself hasn't changed.
   */
  resend(): void;
}

const EMPTY_SET: InterestSet = { systems: [], factions: [], goods: [] };

function sortedKeys(counts: Map<string, number>): string[] {
  return Array.from(counts.keys()).sort();
}

function sameSet(a: InterestSet, b: InterestSet): boolean {
  return (
    a.systems.length === b.systems.length &&
    a.goods.length === b.goods.length &&
    a.systems.every((id, i) => id === b.systems[i]) &&
    a.goods.every((id, i) => id === b.goods[i])
  );
}

export function createInterestRegistry(post: (interest: InterestSet) => void): InterestRegistry {
  const counts: Record<InterestKind, Map<string, number>> = {
    system: new Map(),
    good: new Map(),
  };
  let lastPosted: InterestSet = EMPTY_SET;

  function currentSet(): InterestSet {
    return { systems: sortedKeys(counts.system), goods: sortedKeys(counts.good), factions: [] };
  }

  function postIfChanged(): void {
    const next = currentSet();
    if (sameSet(lastPosted, next)) return;
    lastPosted = next;
    post(next);
  }

  function register(kind: InterestKind, id: string): () => void {
    const map = counts[kind];
    map.set(id, (map.get(id) ?? 0) + 1);
    postIfChanged();

    let released = false;
    return () => {
      if (released) return; // a caller invoking the release function twice must not double-decrement
      released = true;
      const count = map.get(id) ?? 0;
      if (count <= 1) {
        map.delete(id);
      } else {
        map.set(id, count - 1);
      }
      postIfChanged();
    };
  }

  function resend(): void {
    post(lastPosted);
  }

  return { register, resend };
}

let activeRegistry: InterestRegistry | null = null;

/**
 * Binds the one real registry instance to the worker connection — called once, at module scope in
 * `client/main.tsx`, before any panel can mount (React never renders before its own module-scope
 * code finishes running). Returns the instance so `main.tsx` can also call `resend()` off the
 * `isReplacing` transition it already watches.
 */
export function bindInterestRegistry(post: (interest: InterestSet) => void): InterestRegistry {
  activeRegistry = createInterestRegistry(post);
  return activeRegistry;
}

/**
 * Registers a panel's interest on mount / id change, releases on unmount or when `id` moves to
 * `null` (a panel that isn't open, or doesn't know its id yet, declares no interest). `kind`/`id`
 * in the effect's dependency array re-runs register/release across an id change (route navigation
 * between systems) exactly like any other effect keyed on the value it tracks — React runs the
 * previous cleanup (release the old id) before the new effect body (register the new id).
 */
export function useInterest(kind: InterestKind, id: string | null): void {
  useEffect(() => {
    if (id === null) return;
    if (!activeRegistry) return; // no-op outside client/main.tsx's real boot (e.g. an isolated test)
    return activeRegistry.register(kind, id);
  }, [kind, id]);
}
