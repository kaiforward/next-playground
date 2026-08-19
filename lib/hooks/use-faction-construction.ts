"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { FactionConstructionData } from "@/lib/types/api";

/** See `use-faction-vitals.ts`'s NOT_FOUND docstring — same reasoning: this hook's only caller
 *  (`components/construction/faction-construction-card.tsx`) reads its fields directly, so an
 *  absent factionId reads as an empty construction summary. */
const NOT_FOUND: FactionConstructionData = {
  factionId: "",
  pool: 0,
  poolBase: 0,
  poolCentres: 0,
  automation: null,
  buildSystems: [],
  colonies: [],
  orderedCount: 0,
};

/** A faction's construction command summary — read from the store's `factionConstruction` slice,
 *  tick-current by construction. */
export function useFactionConstruction(factionId: string): FactionConstructionData {
  return useGameSlice((state) => state.slices.factionConstruction?.[factionId] ?? NOT_FOUND);
}
