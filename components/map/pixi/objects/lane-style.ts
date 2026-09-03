import { DEFAULT_SYSTEM_COUNT, genConfigForSystemCount } from "@/lib/constants/universe-gen";

/**
 * Pure lane visual weight, derived from a connection's `fuelCost` — no Pixi import, so it's
 * `.test.ts`-able from node. Every lane is the same `WorldConnection` shape; the map reads lane
 * importance straight off the one signal that carries it.
 *
 * Three bands rather than a single threshold. Fuel is priced as (distance ÷ average intra-region
 * hop) × `INTRA_REGION_BASE_FUEL`, times `CROSSING_FUEL_MULTIPLIER` for a corridor's crossing-style
 * lane, so an ordinary lane at typical spacing sits at the base fuel: "notable" catches a lane
 * pricier than 1.5 typical hops, "major" one priced at or beyond a crossing at typical spacing.
 * Neither fuel constant varies with system count, so the default config's values are the values.
 */

export type LaneTier = "ordinary" | "notable" | "major";

const { INTRA_REGION_BASE_FUEL, CROSSING_FUEL_MULTIPLIER } = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);
const NOTABLE_FUEL_THRESHOLD = INTRA_REGION_BASE_FUEL * 1.5;
const MAJOR_FUEL_THRESHOLD = INTRA_REGION_BASE_FUEL * CROSSING_FUEL_MULTIPLIER;

export interface LaneStyle {
  tier: LaneTier;
  width: number;
  alpha: number;
}

export function laneStyleForFuel(fuelCost: number): LaneStyle {
  if (fuelCost >= MAJOR_FUEL_THRESHOLD) return { tier: "major", width: 2.5, alpha: 0.85 };
  if (fuelCost >= NOTABLE_FUEL_THRESHOLD) return { tier: "notable", width: 1.9, alpha: 0.6 };
  return { tier: "ordinary", width: 1.5, alpha: 0.4 };
}
