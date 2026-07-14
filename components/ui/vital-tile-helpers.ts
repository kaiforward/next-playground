/** One weighted segment of a composition sub-bar (e.g. a population skill grade). */
export interface CompositionSegment {
  label: string;
  value: number;
  color: string;
}

/** A composition segment plus its computed display width (percent of the segment sum, 0-100). */
export interface CompositionSegmentWidth extends CompositionSegment {
  pct: number;
}

/**
 * Converts raw segment values into display widths — each segment's share of the sum,
 * as a percentage. A zero (or empty) total yields all-zero widths, never a NaN/Infinity
 * from a 0/0 divide.
 */
export function compositionSegmentWidths(segments: CompositionSegment[]): CompositionSegmentWidth[] {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return segments.map((segment) => ({
    ...segment,
    pct: total > 0 ? (segment.value / total) * 100 : 0,
  }));
}
