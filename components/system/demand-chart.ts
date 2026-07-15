/**
 * Pure view-model for the Population tab's consumer-segmented demand chart. Turns
 * the per-good demand footprint into stacked-bar descriptors — base population /
 * technicians / engineers, plus a "market minimum" floor tail when a good's
 * consumption is floored below its tradeable minimum. No DOM, no React.
 *
 * Palette is the dataviz-validated categorical set (base copper / technician
 * deep-cyan / engineer purple); text always wears text tokens, never these hues.
 */
import type { PopulationDemandEntry } from "@/lib/types/api";

export type DemandSeriesKey = "base" | "technicians" | "engineers" | "floor";

/** Series display config — one entry per stack segment; `floor` renders as a hatched neutral tail. */
export const DEMAND_SERIES: Record<DemandSeriesKey, { label: string; color: string }> = {
  base: { label: "Base population", color: "#d06a42" },
  technicians: { label: "Technicians", color: "#0891b2" },
  engineers: { label: "Engineers", color: "#a855f7" },
  floor: { label: "Market minimum", color: "transparent" },
};

/** The stack order the three consumer tiers render in (base at the divider, engineers at the tail). */
export const DEMAND_TIERS: Array<Exclude<DemandSeriesKey, "floor">> = ["base", "technicians", "engineers"];

export interface DemandSegment {
  key: DemandSeriesKey;
  value: number;
  /** Width as a fraction of this good's own total demand, in [0,1]. */
  fraction: number;
}

export interface DemandBar {
  goodId: string;
  goodName: string;
  /** demandRate — the (possibly floored) total, for the row's value token. */
  total: number;
  /** Non-zero segments in stack order (base → technicians → engineers → floor). */
  segments: DemandSegment[];
  /** total ÷ the largest good's total — the bar's length, so cross-good magnitude reads. */
  scale: number;
}

/**
 * Build stacked demand bars from the (already demand-sorted-descending) footprint.
 * Each bar's segments sum to its `total`: the base/technician/engineer contributions,
 * plus a `floor` remainder when the three sum below the floored `demandRate`. Bars
 * scale to the largest good so the longest bar reads full-width.
 */
export function demandBars(demand: PopulationDemandEntry[]): DemandBar[] {
  const max = demand.reduce((m, d) => Math.max(m, d.demandRate), 0);
  return demand.map((d) => {
    const { base, technicians, engineers } = d.breakdown;
    const floor = Math.max(0, d.demandRate - (base + technicians + engineers));
    const denom = d.demandRate > 0 ? d.demandRate : 1;
    const parts: Array<{ key: DemandSeriesKey; value: number }> = [
      { key: "base", value: base },
      { key: "technicians", value: technicians },
      { key: "engineers", value: engineers },
      { key: "floor", value: floor },
    ];
    return {
      goodId: d.goodId,
      goodName: d.goodName,
      total: d.demandRate,
      segments: parts.filter((p) => p.value > 0).map((p) => ({ key: p.key, value: p.value, fraction: p.value / denom })),
      scale: max > 0 ? d.demandRate / max : 0,
    };
  });
}
