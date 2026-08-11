import { clamp } from "@/lib/utils/math";

/** One contributor's raw value plus its display label and paint colour. */
export interface ContributorSegment {
  label: string;
  value: number;
  color: string;
}

/** One contributor's two figures: what it reads, and how much track that gets to fill. */
export interface ContributorBarWidth {
  label: string;
  color: string;
  /** The TRUE reading as a percentage of the scale — uncapped, and what the row prints. */
  pct: number;
  /** The same reading clamped to the track's own [0,100] limit — what the fill spans. */
  barPct: number;
}

/**
 * Each contributor's share of the shared scale.
 *
 * Two figures per segment, deliberately: the track has a finite width, the reading does not. A
 * contributor at 2.4× the scale fills its bar completely but still prints 240%, so it cannot be
 * mistaken for one sitting exactly at the ceiling. `total <= 0` yields 0 for every segment rather
 * than dividing by zero — a scale of nothing gives nothing to be a share of.
 */
export function contributorBarWidths(
  segments: ReadonlyArray<ContributorSegment>,
  total: number,
): ContributorBarWidth[] {
  return segments.map((segment) => {
    const pct = total > 0 ? (segment.value / total) * 100 : 0;
    return { label: segment.label, color: segment.color, pct, barPct: clamp(pct, 0, 100) };
  });
}

/**
 * Where a threshold marker sits across the same scale, or `undefined` when there is no marker to
 * draw. A marker is dropped rather than floored on a `total <= 0` scale: at zero scale its position
 * would be meaningless, and a tick pinned at 0% reads as a real threshold sitting at zero.
 */
export function thresholdPosition(threshold: number | undefined, total: number): number | undefined {
  if (threshold === undefined || total <= 0) return undefined;
  return clamp((threshold / total) * 100, 0, 100);
}
