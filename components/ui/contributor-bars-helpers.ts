import { clamp } from "@/lib/utils/math";

/** One contributor's raw value plus its display label and paint colour. */
export interface Contributor {
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
 * Two figures per contributor, deliberately: the track has a finite width, the reading does not. A
 * contributor at 2.4× the scale fills its bar completely but still prints 240%, so it cannot be
 * mistaken for one sitting exactly at the ceiling. `total <= 0` yields 0 for every contributor rather
 * than dividing by zero — a scale of nothing gives nothing to be a share of.
 */
export function contributorBarWidths(
  contributors: ReadonlyArray<Contributor>,
  total: number,
): ContributorBarWidth[] {
  return contributors.map((contributor) => {
    const pct = total > 0 ? (contributor.value / total) * 100 : 0;
    return { label: contributor.label, color: contributor.color, pct, barPct: clamp(pct, 0, 100) };
  });
}
