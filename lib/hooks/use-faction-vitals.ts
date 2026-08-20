"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { FactionVitalsData } from "@/lib/types/api";

/**
 * `FactionVitalsData` carries no discriminant to reuse (unlike the per-system reads) and its only
 * caller (`components/top-bar.tsx`) reads its numeric fields directly with no absence check — so an
 * absent factionId reads as the all-zero vitals a faction with no territory would show, rather than
 * a new union member that caller would need to narrow. Judgment call: see Task 7 report.
 */
const NOT_FOUND: FactionVitalsData = {
  territorySize: 0,
  activeSystemCount: 0,
  population: 0,
  stabilityPct: 0,
  developmentPoints: 0,
  developmentPotential: 0,
  developmentPct: 0,
};

/** Faction Overview aggregate vitals — read from the store's `factionVitals` slice, tick-current
 *  by construction. Not visibility-gated — the faction screen is a god-view. */
export function useFactionVitals(factionId: string): FactionVitalsData {
  return useGameSlice((state) => state.slices.factionVitals?.[factionId] ?? NOT_FOUND);
}
