"use client";

import { useMemo } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_VISIBLE_IDS } from "./empty-slices";

/**
 * The player's visibility set — which system IDs are within sensor range. `buildStateFrame`
 * (`lib/runtime/snapshot.ts`) emits every system id in the world for this slice unconditionally
 * (the shipArrived-driven partial visibility this hook's old docstring described was never wired —
 * see the client-runtime measure's side-finding), so this keeps that all-visible semantics: a
 * store-backed read of the same slice, wrapped in a `Set` for the map's fog-of-war checks.
 */
export function useVisibility(): { visibleSystemIds: Set<string> } {
  const systemIds = useGameSlice(
    (state) => state.slices.visibility?.systemIds ?? EMPTY_VISIBLE_IDS,
  );
  const visibleSystemIds = useMemo(() => new Set(systemIds), [systemIds]);
  return { visibleSystemIds };
}
