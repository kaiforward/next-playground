import { clamp } from "@/lib/utils/math";

/**
 * Which edges of its track the marker overhangs. Purely geometric — the caller decides what the
 * position means. Two markers that can legitimately land on the same position stay legible by
 * overhanging opposite edges: one sticks up, the other down, so at identical `pct` they still read
 * as two marks instead of merging into a single thicker smudge.
 */
export type TrackMarkerOverhang = "even" | "up" | "down";

/** Class literals, not template-built, so Tailwind's scanner sees every candidate. */
const OVERHANG_CLASS: Record<TrackMarkerOverhang, string> = {
  even: "-top-0.5 -bottom-0.5",
  up: "-top-1.5 bottom-0",
  down: "top-0 -bottom-1.5",
};

export interface TrackMarkerProps {
  /** Position across the track, 0-100. Clamped, so a marker can never escape the track it marks. */
  pct: number;
  /** CSS colour — a `var(--color-*)` token or a resolved string, never a Tailwind class. */
  color: string;
  /** Dashed reads as "not the present" — a remembered level, a projected one. Solid is a fact of
   *  now, or a fixed line of the rules. */
  dashed?: boolean;
  overhang?: TrackMarkerOverhang;
}

/**
 * A vertical mark drawn at a percentage position across a track — the shared vocabulary for
 * "something worth marking sits *here* on this axis" (the Provisioned track's today/remembered
 * levels, the Provisioned vital tile's remembered level, the Stability track's heading-to and
 * strike lines). Position-and-appearance only: it
 * carries no notion of what the mark means, so no caller can teach it one domain's semantics at
 * another's expense.
 *
 * Requires a `relative` positioned parent — the track itself.
 */
export function TrackMarker({ pct, color, dashed = false, overhang = "even" }: TrackMarkerProps) {
  const left = `${clamp(pct, 0, 100)}%`;
  if (dashed) {
    // Zero-width span; only its left border paints.
    return (
      <span
        aria-hidden
        className={`absolute ${OVERHANG_CLASS[overhang]} border-l-2 border-dashed`}
        style={{ left, borderColor: color }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`absolute ${OVERHANG_CLASS[overhang]} w-0.5`}
      style={{ left, backgroundColor: color }}
    />
  );
}
