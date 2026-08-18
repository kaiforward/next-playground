/**
 * Population-tab view-model for the Stability block — **the one place** an unrest-scaled quantity
 * becomes a stability-scaled one. Everything the block renders comes out of `stabilityView`
 * already inverted, so no component performs its own `1 - x`. This is not tidiness: the same
 * inversion has been shipped wrong three times on this one panel (an unrest headline under a
 * "Stability" heading; a strike marker drawn per contributor bar, implying a per-cause threshold
 * that does not exist; and a `trend` field that says "rising" about *unrest* on a world whose
 * stability is falling). One function, one direction, one place to get it right.
 *
 * The block shows two different moments and must say so. The headline is **now** — live `unrest`,
 * the same value the badge label, the badge colour and `striking` all read. The outlook is
 * **where it is heading** — `settled`, the fixed point the accumulator relaxes toward. Unrest
 * climbs gradually, so a world can sit at a calm 85% while its causes have already settled at
 * total collapse; the gap between the fill and the heading-to rule is exactly that story, and it
 * is the thing the panel exists to show. The headline is never derived from `settled`, or the
 * divergence would be averaged away into a single reassuring number.
 *
 * The causes keep the raw contributor scale on purpose — a cause contributing 0.3 of unrest **is**
 * a cause costing 30 points of stability, the same magnitude, so there is no second inversion here
 * to get backwards. They are not re-scaled, re-ordered or capped.
 *
 * The badge is the one thing the block still feeds raw `unrest`: `StabilityBadge` renders a word
 * and a colour off the shared `lib/utils/stability` ramp — the same ramp the map's stability mode
 * uses, and already stability-phrased ("Stable"…"Strike") — never a number, so it is not a surface
 * the inversion can be got wrong on.
 */
import { clamp } from "@/lib/utils/math";
import { fractionPct } from "@/lib/utils/format";
import { stabilityRampColor } from "@/lib/utils/stability";
import type { UnrestTrend } from "@/lib/engine/unrest-readout";
import type { Contributor } from "@/components/ui/contributor-bars";
import type { SystemUnrestRead } from "@/lib/types/api";

/** Which way **stability** is moving. Deliberately not the unrest trend's own words: `"rising"`
 *  unrest is stability *falling*, and printing the read's word verbatim under a Stability heading
 *  would tell the owner a collapsing world is improving. */
export type StabilityDirection = "falling" | "holding" | "climbing";

/** The inversion, as a table rather than a conditional, so every arm is visible at once. */
const DIRECTION_FROM_TREND: Record<UnrestTrend, StabilityDirection> = {
  rising: "falling",
  stable: "holding",
  recovering: "climbing",
};

export const DIRECTION_WORD: Record<StabilityDirection, string> = {
  falling: "Falling",
  holding: "Holding",
  climbing: "Climbing",
};

export const DIRECTION_GLYPH: Record<StabilityDirection, string> = {
  falling: "▼",
  holding: "—",
  climbing: "▲",
};

/** Text colour token per direction — falling reads as warning, climbing as relief, holding quiet. */
export const DIRECTION_TEXT: Record<StabilityDirection, string> = {
  falling: "text-status-amber-light",
  holding: "text-text-tertiary",
  climbing: "text-status-green-light",
};

/**
 * Where stability is heading, as a whole percentage, plus which way that is from here. Absent on an
 * unassessed system: `settled` and `trend` both need the goods term, which the read withholds
 * before the first economy cycle, and a marker drawn from tax and crowding alone would place a
 * starving world's outlook near the top of the track.
 */
export type StabilityOutlook =
  | { known: true; pct: number; direction: StabilityDirection }
  | { known: false };

export interface StabilityView {
  /** Stability now, whole percent — `1 − unrest`, clamped into [0, 100]. */
  pct: number;
  /** Paint for the fill and its key swatch — the shared unrest ramp's colour for this level. */
  color: string;
  /** The stability at which the workforce strikes, whole percent — `1 − strikeThreshold`. */
  strikePct: number;
  outlook: StabilityOutlook;
  /**
   * The causes, on the raw contributor scale against a total of 1 — each value is the stability
   * points that cause is costing. Ordered goods → tax → crowding; the goods entry is absent
   * (not zeroed) on an unassessed system.
   */
  causes: Contributor[];
  /** True when the goods cause is withheld, so the causes shown do not add up to the whole story
   *  and the block must say so rather than let their absence read as "no goods problem". */
  causesIncomplete: boolean;
  striking: boolean;
}

/**
 * Everything the Stability block renders, already on the stability scale. The only input that is
 * unrest-scaled is what comes in; nothing unrest-scaled comes out except the cause magnitudes,
 * which are scale-identical by construction (see the module docstring).
 */
export function stabilityView({
  unrest,
  striking,
  read,
}: {
  unrest: number;
  striking: boolean;
  read: SystemUnrestRead;
}): StabilityView {
  const tax: Contributor = {
    label: "Tax pressure",
    value: read.contributors.tax,
    color: "var(--color-status-blue)",
  };
  const crowding: Contributor = {
    label: "Crowding",
    value: read.contributors.crowding,
    color: "var(--color-status-purple)",
  };

  return {
    pct: fractionPct(clamp(1 - unrest, 0, 1)),
    color: stabilityRampColor(unrest),
    strikePct: fractionPct(clamp(1 - read.strikeThreshold, 0, 1)),
    outlook: read.assessed
      ? {
          known: true,
          pct: fractionPct(clamp(1 - read.settled, 0, 1)),
          direction: DIRECTION_FROM_TREND[read.trend],
        }
      : { known: false },
    causes: read.assessed
      ? [
          { label: "Goods shortfall", value: read.contributors.goods, color: "var(--color-status-amber)" },
          tax,
          crowding,
        ]
      : [tax, crowding],
    causesIncomplete: !read.assessed,
    striking,
  };
}
