/**
 * The alert run's adaptive packing — pure arithmetic, no DOM. Pulled out of `AlertRun` because the
 * packing decision's only observable is a style (a gap, an overlap margin), and jsdom carries no
 * layout: a class or style assertion there would pass exactly as well with the stylesheet deleted.
 * This module carries every packing number, so `alert-packing.test.ts` (node, real algebra) is what
 * actually proves the packing, and `AlertRun`'s own jsdom test only has to prove the call is wired
 * with the right arguments and the right chips render for the result.
 *
 * The four steps, in the order they are tried (docs/build-plans/alert-bar.md → "Packing adapts to
 * the space, in four steps"):
 *   1. `spaced`   — a small positive gap between chips, whenever the run fits like that.
 *   2. `overlap8` — chips overlap by the EU5-style nominal amount once spaced doesn't fit.
 *   3. `overlap16` — tightened to the floor overlap before anything is given up.
 *   4. `collapse` — past the floor, the least-severe chips fold into a trailing "+N", never a
 *      critical one (the settings forbid hiding those; layout must not either).
 *
 * `CHIP_WIDTH` etc. are estimates of `AlertChip`'s own rendered footprint, not a measurement of it —
 * there is no layout available to measure at the point this function is called from. They only need
 * to be internally consistent, since every width this module compares is expressed in the same
 * units.
 */

/**
 * One chip's estimated footprint, in CSS pixels — computed from `AlertChip`'s own classes
 * (`components/alerts/alert-chip.tsx`), not measured, since there is no layout available at the
 * point this module is called from:
 *
 *   border (`border`, 1px each side)            2px
 *   horizontal padding (`px-[9px]`)             18px
 *   icon (`w-5`)                                20px
 *   icon-to-count gap (`gap-1.5`, one gap —      6px
 *     the `sr-only` label/unit spans are `position: absolute`, out of flow, and so is the bare
 *     text-node space between them, per that component's own docstring — neither is a flex item
 *     and neither costs a gap)
 *   count digits (`font-mono`, ~8px/digit)    8px × digits
 *
 * = 46px + 8px per count digit. Counts here run into the hundreds — Build blocked was measured at
 * 50.4% of developed systems (alert-bar.md → "The flyout") — so three digits is the realistic
 * maximum, not the exceptional case: 46 + 8×3 = 70px. Rounding to a one- or two-digit estimate
 * would let `packRun` certify a fit the real three-digit chip overflows.
 */
export const CHIP_WIDTH = 70;
/** Gap between chips at the `spaced` step. */
export const SPACED_GAP = 5;
/** Overlap (negative gap) at the `overlap8` step. */
export const OVERLAP_NOMINAL = -8;
/** Overlap (negative gap) at the `overlap16` step — the floor for an ordinary, non-critical run. */
export const OVERLAP_FLOOR = -16;
/**
 * Overlap (negative gap) the critical tier alone is allowed to squeeze to, past `OVERLAP_FLOOR`,
 * before the run gives up and renders nothing — "the critical chips overlap past 16px rather than
 * collapse" (alert-bar.md → "The +N collapse never consumes a critical chip"). Deliberately close to
 * `CHIP_WIDTH` in magnitude: chips overlap almost entirely, leaving only a sliver of each visible,
 * the last resort before the tier itself can't be shown.
 */
export const CRITICAL_STACK_OVERLAP = -(CHIP_WIDTH - 8);
/**
 * The trailing "+N" chip's footprint — narrower than an ordinary chip since it carries no icon, just
 * a number. Same arithmetic as `CHIP_WIDTH` with the icon and its `gap-1.5` removed: border 2px +
 * `px-[9px]` 18px + the label's own glyphs at ~8px each in 13px monospace. The widest label the run
 * can produce is `+12` — sixteen categories less the four critical ones it may never fold — so three
 * glyphs, giving 20 + 24 = 44, rounded to 46 for the same reason `CHIP_WIDTH` rounds up: an
 * underestimate lets `packRun` certify a fit that overflows, which is the failure this whole module
 * exists to prevent, while an overestimate only packs one chip more conservatively than it had to.
 */
export const PLUS_N_WIDTH = 46;

export interface PackResult {
  step: "spaced" | "overlap8" | "overlap16" | "collapse";
  /** How many chips (from the front of the ordered list) actually render. */
  visible: number;
  /** How many trailing chips fold into the "+N" tail — always 0 outside `collapse`. */
  collapsed: number;
  /**
   * The actual per-adjacent gap (positive) or overlap (negative) CSS pixels the caller must apply
   * between visible chips — the real value `packRun` verified fits. `step` alone is not enough to
   * render from: the `collapse` step covers three different fits (dropping a tail at
   * `OVERLAP_FLOOR`, the critical tier alone at `OVERLAP_FLOOR`, and the critical tier squeezed to
   * `CRITICAL_STACK_OVERLAP`), and the last of those needs a far larger overlap than the other two
   * to actually fit `availableWidth` — rendering it at the ordinary floor would reintroduce the
   * overflow this module exists to prevent. `visible <= 1` chips need no gap at all; the value is
   * still one of the constants above so a caller can render consistently.
   */
  gap: number;
}

/** Whether `gap` is an overlap (chips drawn closer than their `spaced` resting gap) rather than
 *  positive spacing — gates the rightward shadow, the tier separator's tighter margins, and the
 *  "no extra overlap right after a separator" rule (alert-bar-prototype.html's `.bar-chips.overlap`
 *  rules). */
export function isOverlapping(gap: number): boolean {
  return gap < 0;
}

/**
 * The marginLeft (CSS pixels) before a visible chip at the given position, given the packing `gap`
 * `packRun` computed for this render. The very first item in the run never gets a margin. A chip
 * immediately after another chip uses `gap` as-is (positive spacing or negative overlap). A chip
 * immediately after the tier separator drops the overlap to 0 once overlapping — the separator
 * already provides the visual break (alert-bar-prototype.html: `.bar-chips.overlap .tier-gap +
 * .chip { margin-left: 0 }`) — but keeps the ordinary spaced gap while not overlapping, since there
 * is no separate host `gap` to fall back on here.
 */
export function chipMarginLeft(gap: number, position: "first" | "after-chip" | "after-separator"): number {
  if (position === "first") return 0;
  if (position === "after-separator" && isOverlapping(gap)) return 0;
  return gap;
}

/** The tier separator's own left/right margins (CSS pixels) for the given packing `gap` — spaced
 *  keeps the resting symmetric margin, any overlap step switches to the prototype's asymmetric one
 *  (alert-bar-prototype.html: base `.tier-gap { margin: 0 3px }`, `.bar-chips.overlap .tier-gap {
 *  margin: 0 5px 0 9px }`). */
export function separatorMargins(gap: number): { left: number; right: number } {
  return isOverlapping(gap) ? { left: 9, right: 5 } : { left: 3, right: 3 };
}

/** Resting stack z-index for the chip at `index` (0-based, front = most severe) among `total`
 *  visible chips — alert-bar-prototype.html's own `--z: (cats.length - i)`, so the leftmost, most
 *  severe chip paints over every chip to its right by default, before any hover/open raise. */
export function stackZIndex(index: number, total: number): number {
  return total - index;
}

/** Total width `n` chips need at a given per-gap `gap` (which may be negative, for an overlap). */
function widthFor(n: number, gap: number): number {
  if (n <= 0) return 0;
  return n * CHIP_WIDTH + Math.max(0, n - 1) * gap;
}

/**
 * Decide how the run packs `chipCount` ordered chips (critical tier first, by the caller's own
 * contract — this function trusts that ordering rather than re-deriving it) into `availableWidth`
 * CSS pixels, given that the first `criticalCount` of them are critical and may never be folded into
 * the collapsed tail.
 *
 * Tries the three fixed-gap steps in order; past the floor, drops chips from the END of the list
 * (least severe first) until what remains, plus a reserved "+N" chip, fits — but never drops below
 * `criticalCount` visible. If even the critical tier plus a "+N" doesn't fit at the ordinary floor,
 * the critical tier alone is allowed to overlap further, down to `CRITICAL_STACK_OVERLAP`. Only if
 * that still doesn't fit does the run render nothing (`visible: 0, collapsed: 0`) — the floor below
 * which overflowing is worse than showing nothing, per alert-bar.md's placement section.
 */
export function packRun(chipCount: number, availableWidth: number, criticalCount: number): PackResult {
  if (chipCount <= 0 || availableWidth <= 0) {
    return { step: "collapse", visible: 0, collapsed: 0, gap: 0 };
  }

  if (widthFor(chipCount, SPACED_GAP) <= availableWidth) {
    return { step: "spaced", visible: chipCount, collapsed: 0, gap: SPACED_GAP };
  }
  if (widthFor(chipCount, OVERLAP_NOMINAL) <= availableWidth) {
    return { step: "overlap8", visible: chipCount, collapsed: 0, gap: OVERLAP_NOMINAL };
  }
  if (widthFor(chipCount, OVERLAP_FLOOR) <= availableWidth) {
    return { step: "overlap16", visible: chipCount, collapsed: 0, gap: OVERLAP_FLOOR };
  }

  // Past the floor: give up chips from the least-severe end, one at a time, never past
  // criticalCount, re-checking the floor pack (plus the reserved "+N") at each candidate count.
  for (let visible = chipCount - 1; visible > criticalCount; visible--) {
    const need = widthFor(visible, OVERLAP_FLOOR) + PLUS_N_WIDTH;
    if (need <= availableWidth) {
      return { step: "collapse", visible, collapsed: chipCount - visible, gap: OVERLAP_FLOOR };
    }
  }

  // Down to just the critical tier (with a "+N" for the rest, if there is any rest to name).
  const collapsedAtCritical = chipCount - criticalCount;
  const plusNIfAny = collapsedAtCritical > 0 ? PLUS_N_WIDTH : 0;
  if (widthFor(criticalCount, OVERLAP_FLOOR) + plusNIfAny <= availableWidth) {
    return { step: "collapse", visible: criticalCount, collapsed: collapsedAtCritical, gap: OVERLAP_FLOOR };
  }

  // Even that doesn't fit: the settings forbid hiding a critical chip by turning it off, and
  // layout must not do it by dropping one into the tail either — so the critical tier stacks
  // past the ordinary floor instead of collapsing.
  if (widthFor(criticalCount, CRITICAL_STACK_OVERLAP) + plusNIfAny <= availableWidth) {
    return {
      step: "collapse",
      visible: criticalCount,
      collapsed: collapsedAtCritical,
      gap: CRITICAL_STACK_OVERLAP,
    };
  }

  // Not even the critical tier, maximally stacked, plus a "+N" fits: render nothing rather than
  // overflow the map.
  return { step: "collapse", visible: 0, collapsed: 0, gap: 0 };
}
