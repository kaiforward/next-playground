import { weightedMean } from "@/lib/utils/math";
import type { AtlasSystem } from "@/lib/types/game";
import type { ValueMode } from "./value-ramp";

export type Tier = "system" | "faction-region" | "faction";

export interface AggGroup {
  key: string;
  tier: Tier;
  cx: number;
  cy: number;
  memberIds: string[];
  value: number; // population / development → sum; stability / migration → population-weighted mean
}

export interface AggregationTiers {
  system: AggGroup[];
  factionRegion: AggGroup[];
  faction: AggGroup[];
}

// Stability and migration are INTENSIVE modes — rates (1 − unrest / attractiveness) that must be
// population-weighted so a populous core dominates and a tiny outpost can't drag it down. Population and
// development are EXTENSIVE magnitudes → summed, so spreading into new systems adds instead of diluting.
// (Migration is colour-only for now — this only matters once numbers are shown.)
const isWeightedMode = (m: ValueMode) => m === "stability" || m === "migration";

export function aggregateValue(vals: number[], weights: number[], mode: ValueMode): number {
  if (vals.length === 0) return 0;
  if (isWeightedMode(mode)) return weightedMean(vals, weights);
  return vals.reduce((a, b) => a + b, 0);
}

function push<K>(map: Map<K, AtlasSystem[]>, key: K, s: AtlasSystem): void {
  const arr = map.get(key);
  if (arr) arr.push(s);
  else map.set(key, [s]);
}

export function buildAggregationGroups(
  systems: AtlasSystem[],
  values: Map<string, number>,
  mode: ValueMode,
  weights?: Map<string, number>,
): AggregationTiers {
  const system: AggGroup[] = [];
  const frMap = new Map<string, AtlasSystem[]>();
  const faMap = new Map<string, AtlasSystem[]>();

  for (const s of systems) {
    system.push({ key: s.id, tier: "system", cx: s.x, cy: s.y, memberIds: [s.id], value: values.get(s.id) ?? 0 });
    if (s.factionId == null) continue; // unclaimed → forms no group
    push(frMap, `${s.factionId}|${s.regionId}`, s);
    push(faMap, s.factionId, s);
  }

  const groupFrom = (key: string, tier: Tier, mem: AtlasSystem[]): AggGroup => {
    // Aggregate only over members that HAVE a value — an absent system (e.g. undeveloped, so no
    // stability) must not count as a 0 that drags the number down; it's simply not part of the total.
    // Weights parallel the kept values (stability weights by population); a missing weight defaults to
    // 1 so a population-weighted mean degrades to a plain mean rather than dropping the member.
    const vals: number[] = [];
    const wts: number[] = [];
    for (const s of mem) {
      const v = values.get(s.id);
      if (v === undefined) continue;
      vals.push(v);
      wts.push(weights?.get(s.id) ?? 1);
    }
    return {
      key,
      tier,
      cx: mem.reduce((a, s) => a + s.x, 0) / mem.length,
      cy: mem.reduce((a, s) => a + s.y, 0) / mem.length,
      memberIds: mem.map((s) => s.id),
      value: aggregateValue(vals, wts, mode),
    };
  };

  return {
    system,
    factionRegion: [...frMap].map(([k, mem]) => groupFrom(k, "faction-region", mem)),
    faction: [...faMap].map(([k, mem]) => groupFrom(k, "faction", mem)),
  };
}

export interface TierThresholds {
  factionToRegion: number; // camera zoom at/above which mid-tier shows
  regionToSystem: number; // camera zoom at/above which per-system numbers show
}

// Camera zoom runs 0..CAMERA.maxZoom (2.5). Tuned on the real map: faction totals give way to
// per-region totals at 0.285, and to per-system numbers at 0.385.
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { factionToRegion: 0.285, regionToSystem: 0.385 };

export function pickTier(zoom: number, t: TierThresholds): Tier {
  if (zoom >= t.regionToSystem) return "system";
  if (zoom >= t.factionToRegion) return "faction-region";
  return "faction";
}
