import type { AtlasSystem } from "@/lib/types/game";
import type { ValueMode } from "./value-ramp";

export type Tier = "system" | "faction-region" | "faction";

export interface AggGroup {
  key: string;
  tier: Tier;
  cx: number;
  cy: number;
  memberIds: string[];
  value: number; // population → sum; development / stability → average
}

export interface AggregationTiers {
  system: AggGroup[];
  factionRegion: AggGroup[];
  faction: AggGroup[];
}

const isAverageMode = (m: ValueMode) => m !== "population";

export function aggregateValue(vals: number[], mode: ValueMode): number {
  if (vals.length === 0) return 0;
  const sum = vals.reduce((a, b) => a + b, 0);
  return isAverageMode(mode) ? sum / vals.length : sum;
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

  const groupFrom = (key: string, tier: Tier, mem: AtlasSystem[]): AggGroup => ({
    key,
    tier,
    cx: mem.reduce((a, s) => a + s.x, 0) / mem.length,
    cy: mem.reduce((a, s) => a + s.y, 0) / mem.length,
    memberIds: mem.map((s) => s.id),
    // Aggregate only over members that HAVE a value — an absent system (e.g. undeveloped, so no
    // stability) must not count as a 0 that drags an average down; it's simply not part of the total.
    value: aggregateValue(
      mem.flatMap((s) => {
        const v = values.get(s.id);
        return v === undefined ? [] : [v];
      }),
      mode,
    ),
  });

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
