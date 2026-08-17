/**
 * The alert run's geometry — one model, pure arithmetic, no DOM.
 *
 * `layoutRun` is the only thing that decides where anything in the run goes. It hands back every
 * element the run draws — the settings control, each chip, each tier separator, the trailing "+N" —
 * in render order, each already placed at an explicit left offset in CSS pixels. `AlertRunChips`
 * (`components/alerts/alert-run.tsx`) draws that list and computes no position of its own.
 *
 * The fit decision and the placement are the SAME walk (`placeRun`): a candidate step is tried by
 * laying it out and reading the right-hand edge back off the items, never by a second width formula
 * running beside it. An element the run draws and an element the fit check pays for therefore cannot
 * come apart, which is the failure class this module exists to prevent.
 *
 * Every number here is derived from an authored Tailwind class on the elements the run renders
 * (`components/alerts/alert-chip.tsx`, `components/alerts/alert-run.tsx`), never measured — there is
 * no layout available at the point this is called from. `CHIP_DIGIT_WIDTH` is the single exception;
 * see its own docstring.
 *
 * The four steps, in the order they are tried (docs/active/gameplay/alert-bar.md → "Packing adapts
 * to the space, in four steps"):
 *   1. `SPACED_GAP`      — a small positive gap between chips, whenever the run fits like that.
 *   2. `OVERLAP_NOMINAL` — chips overlap by the EU5-style nominal amount once spaced doesn't fit.
 *   3. `OVERLAP_FLOOR`   — tightened to the floor overlap before anything is given up.
 *   4. collapse          — past the floor, the least-severe chips fold into a trailing "+N", never a
 *      critical one (the settings forbid hiding those; layout must not either). Rather than fold one,
 *      the critical tier squeezes past the floor to `criticalStackOverlap` — the deepest overlap that
 *      still leaves a sliver of every chip in that stack showing.
 */

import type { AlertTier } from "@/lib/types/alerts";

/**
 * The part of one chip's footprint that does not vary with what it shows, in CSS pixels — computed
 * from `AlertChip`'s own classes (`components/alerts/alert-chip.tsx`):
 *
 *   border (`border`, 1px each side)            2px
 *   horizontal padding (`px-[9px]`)             18px
 *   icon (`w-5`)                                20px
 *   icon-to-count gap (`gap-1.5`, one gap —      6px
 *     the `sr-only` label/unit spans are `position: absolute`, out of flow, and so is the bare
 *     text-node space between them, per that component's own docstring — neither is a flex item
 *     and neither costs a gap)
 *
 * = 46px, before the count's own glyphs.
 */
export const CHIP_BASE_WIDTH = 46;

/**
 * One count glyph's advance width, in CSS pixels — the **single term in this module that is not
 * derivable from a Tailwind class**. It is the advance of one digit in the count span's
 * `font-mono font-medium` at the chip's `text-[13px]` (`components/alerts/alert-chip.tsx:30,181`),
 * which depends on whichever face the `font-mono` stack actually resolves to on the machine
 * rendering it. Nothing in the authored CSS states it, so it can only be read off a rendered chip.
 * The value below is an authored estimate, not a measurement.
 *
 * To re-measure — required if the type scale, the weight or the `font-mono` stack ever changes —
 * open the running game's devtools, select a chip's count span (the `font-mono font-medium` one),
 * and evaluate against it:
 *
 *   const s = getComputedStyle($0);
 *   const c = document.createElement("canvas").getContext("2d");
 *   c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
 *   c.measureText("0").width;
 *
 * One glyph is the whole measurement: every digit has the same advance in a monospaced face. Round
 * the result UP to a whole pixel — an underestimate lets `layoutRun` certify a fit that then
 * overflows the map, while an overestimate only packs one step more conservatively than it had to.
 */
export const CHIP_DIGIT_WIDTH = 8;

/**
 * The run's own height in CSS pixels, and the box every item is vertically centred in — `AlertChip`'s
 * `h-[26px]` shell (`components/alerts/alert-chip.tsx`), the tallest thing the run draws. The run's
 * items are absolutely positioned at the offsets `layoutRun` hands out, so they contribute no height
 * of their own and their container has to state it.
 */
export const RUN_HEIGHT = 26;

/** How many glyphs `AlertChip` renders for `count` — it prints the number verbatim, so this is the
 *  count's own decimal length. Anything that is not a positive integer (0, a negative, a fraction,
 *  `NaN`, `Infinity`) charges one glyph: a chip is never zero-width, and a `NaN` width would
 *  propagate through every comparison in this module and silently certify anything. */
function countGlyphs(count: number): number {
  if (!Number.isInteger(count) || count < 1) return 1;
  return String(count).length;
}

/**
 * One chip's footprint, in CSS pixels, for the count it actually shows — the shell
 * (`CHIP_BASE_WIDTH`) plus one `CHIP_DIGIT_WIDTH` per rendered glyph. A chip showing `3` is 54px,
 * one showing `42` is 62px and one showing `253` is 70px.
 *
 * A function rather than a constant because the count is the one thing that moves it, the caller
 * already holds the count, and charging every chip the widest case over-budgets a typical run by
 * 16px per chip — enough to collapse and overlap a run that had room to sit spaced.
 */
export function chipWidth(count: number): number {
  return CHIP_BASE_WIDTH + CHIP_DIGIT_WIDTH * countGlyphs(count);
}

/** One chip as the layout needs it: the tier it belongs to (which decides the critical prefix and
 *  where the separators fall) and the count it renders (which decides how wide it is). `layoutRun`
 *  is generic over anything carrying these two, so a caller can hand it its own richer chip object
 *  and read that same object back off the placed item rather than indexing a parallel array. */
export interface RunChip {
  tier: AlertTier;
  count: number;
}

/** Gap between chips at the `spaced` step. */
export const SPACED_GAP = 5;
/** Overlap (negative gap) at the `overlap8` step. */
export const OVERLAP_NOMINAL = -8;
/** Overlap (negative gap) at the `overlap16` step — the floor for an ordinary, non-critical run. */
export const OVERLAP_FLOOR = -16;
/**
 * How much of each chip in a maximally-stacked critical tier stays visible, in CSS pixels — the
 * sliver that makes the stack read as several chips rather than one. It is what
 * `criticalStackOverlap` solves the overlap for.
 */
export const CRITICAL_STACK_SLIVER = 8;

/**
 * The trailing "+N" chip's footprint — narrower than an ordinary chip since it carries no icon, just
 * a number. Same arithmetic as `chipWidth` with the icon and its `gap-1.5` removed: border 2px +
 * `px-[9px]` 18px + the label's own glyphs at `CHIP_DIGIT_WIDTH` each in 13px monospace. The widest
 * label the run can produce is `+12` — sixteen categories less the four critical ones it may never
 * fold — so three glyphs, giving 20 + 24 = 44, rounded up to 46: an underestimate lets `layoutRun`
 * certify a fit that overflows, while an overestimate only packs one step more conservatively than
 * it had to.
 *
 * A flat constant, not a function of N the way `chipWidth` is a function of its count, because its
 * whole range is two or three glyphs and 46 already covers the wider of those. A chip's count has no
 * such ceiling — it runs into the hundreds — so the same round-up rule that costs the tail one
 * narrow label's worth, at most once per run, would cost every chip in the run 16px each.
 */
export const PLUS_N_WIDTH = 46;

/**
 * The settings control's own footprint, in CSS pixels — computed from `AlertChip`'s shared `chip`
 * shell (`components/alerts/alert-chip.tsx`), which the control reuses verbatim
 * (`components/alerts/alert-run.tsx`), the same way `PLUS_N_WIDTH` reuses it:
 *
 *   border (`border`, 1px each side)            2px
 *   horizontal padding (`px-[9px]`)             18px
 *   icon (`w-5`)                                20px
 *
 * = 40px. No `gap-1.5` term: that class only costs space BETWEEN flex items, and the control has one
 * child — the icon alone, no count, no label — so there is nothing for it to sit next to. The
 * arithmetic is already exact in whole pixels, so there is no fraction to round.
 */
export const SETTINGS_WIDTH = 40;

/** The tier separator's own rendered width, in CSS pixels — `w-px`, a one-pixel hairline
 *  (`TierSeparator`, `components/alerts/alert-run.tsx`). */
export const SEPARATOR_WIDTH = 1;

/** Whether `gap` is an overlap (chips drawn closer than their `spaced` resting gap) rather than
 *  positive spacing — decides the rightward shadow, the tier separator's tighter margins, and the
 *  rule that nothing is ever pulled back over the control or a separator. A zero gap is not an
 *  overlap: the give-up branch places the control alone at `gap: 0`, and the control takes its own
 *  shadow from that. */
function isOverlapping(gap: number): boolean {
  return gap < 0;
}

/** The tier separator's own left/right margins (CSS pixels) at the given packing `gap` — a spaced
 *  run keeps a symmetric 3px on each side; any overlap step switches to an asymmetric 9px/5px, the
 *  extra room on the left standing in for the overlap the chip before it has already eaten. */
function separatorMargins(gap: number): { left: number; right: number } {
  return isOverlapping(gap) ? { left: 9, right: 5 } : { left: 3, right: 3 };
}

/**
 * The deepest overlap (negative gap) the first `count` chips are allowed to squeeze to before the
 * run gives up and renders nothing — "the critical chips overlap past 16px rather than collapse"
 * (docs/active/gameplay/alert-bar.md → "Placement and behaviour").
 *
 * Solved against the NARROWEST chip actually being stacked, so that every chip in the stack still
 * shows `CRITICAL_STACK_SLIVER` px of itself: the gap is a single value applied between chips that
 * may each be a different width, and the per-chip advance it produces is `chipWidth + gap`, so the
 * narrowest member is the one that decides whether the stack reads as chips at all. An anchor taken
 * from the widest a chip could theoretically get instead drives that advance NEGATIVE for a run of
 * narrow counts — the next chip drawn to the left of the one before it, on top of the control.
 *
 * Never looser than `OVERLAP_FLOOR`: this step is tried after the floor, so a value above it would
 * be a step that asks for more room than the step it follows.
 */
export function criticalStackOverlap(chips: readonly RunChip[], count: number): number {
  const stacked = Math.min(count, chips.length);
  if (stacked <= 0) return OVERLAP_FLOOR;
  let narrowest = chipWidth(chips[0].count);
  for (let i = 1; i < stacked; i++) narrowest = Math.min(narrowest, chipWidth(chips[i].count));
  return Math.min(OVERLAP_FLOOR, -(narrowest - CRITICAL_STACK_SLIVER));
}

/**
 * One element of the run, placed. `left` is its offset in CSS pixels from the run's left edge and
 * `width` is what it occupies there; together those are the whole of its horizontal geometry, and
 * the caller applies them directly rather than deriving a margin from a neighbour.
 *
 * Generic over the caller's own chip object (anything that is a `RunChip`) so a placed chip carries
 * the very object it was laid out from — the caller reads `chip` back rather than indexing its own
 * list by a position this module would otherwise have to promise it kept.
 */
export type PlacedItem<T extends RunChip> =
  /** The settings control. Always the run's first item, always at `left: 0`. */
  | { kind: "control"; left: number; width: number }
  /** One category's chip. `zIndex` is its resting stack order — the run paints back to front, so the
   *  leftmost, most severe chip sits over every chip to its right before any hover/open raise. */
  | { kind: "chip"; chip: T; left: number; width: number; zIndex: number }
  /** The hairline between two tier groups. Its own margins are already spent in the offsets around
   *  it; what is left is the `w-px` rule itself. */
  | { kind: "separator"; left: number; width: number }
  /** The trailing "+N", naming how many least-severe chips folded away. */
  | { kind: "tail"; collapsed: number; left: number; width: number };

export interface RunLayout<T extends RunChip> {
  /** Every element the run draws, in render order — which is also left-to-right order. */
  items: readonly PlacedItem<T>[];
  /** Whether the run packed at a negative gap: the chip shell's shadow variant and the hover raise. */
  overlapping: boolean;
  /** The run's right-hand edge — the furthest right any placed item reaches. Exactly the width the
   *  fit check compared against `availableWidth`, so nothing is reserved here that is not placed. */
  contentWidth: number;
}

/** The furthest right any placed item reaches. Taken across every item rather than off the last one,
 *  since a narrow chip can follow a wide one at a deep overlap and end short of it. */
function rightEdge<T extends RunChip>(items: readonly PlacedItem<T>[]): number {
  let edge = 0;
  for (const item of items) edge = Math.max(edge, item.left + item.width);
  return edge;
}

/**
 * Lay the run out at one candidate step: the control, then the first `visible` chips with a
 * separator wherever the tier changes, then a "+N" if `collapsed` chips folded away. This is the
 * only place a position is computed, for measuring a candidate and for rendering the chosen one
 * alike.
 *
 * The walk carries two numbers. `edge` is where the next item's own margin is measured from — the
 * run's right-hand edge so far, including any trailing margin the item before it claimed (only the
 * separator has one). `previousLeft` is the left offset of the item placed last, and clamping every
 * new offset against it is what makes the run's ordering structural: **no item can start left of the
 * item before it**, whatever gap it was handed. The gap rules are meant to keep well clear of that
 * clamp — `criticalStackOverlap` leaves every chip a `CRITICAL_STACK_SLIVER` — but a chip drawn
 * behind its own predecessor, over the control, is a worse failure than a stack one pixel tighter
 * than intended, so the floor is enforced here rather than trusted upstream.
 */
function placeRun<T extends RunChip>(
  chips: readonly T[],
  visible: number,
  gap: number,
  collapsed: number,
): PlacedItem<T>[] {
  const separator = separatorMargins(gap);
  // What an item whose left-hand neighbour is NOT a chip takes: the ordinary spaced gap while the
  // run is spaced, nothing at all once it overlaps. Both neighbours it covers refuse a negative
  // margin for their own reason — a separator already provides the visual break, so pulling the chip
  // back over it would swallow it; and the settings control sits outside the severity ordering that
  // lets chips cover each other, so nothing may slide back on top of the run's only entry point
  // into its own categories.
  const afterNonChip = isOverlapping(gap) ? 0 : gap;

  const items: PlacedItem<T>[] = [];
  let edge = 0;
  let previousLeft = 0;

  function placeAt(margin: number, width: number): number {
    const left = Math.max(edge + margin, previousLeft);
    previousLeft = left;
    edge = left + width;
    return left;
  }

  // The control leads the run and renders whatever else does, so it anchors the walk at 0.
  items.push({ kind: "control", left: placeAt(0, SETTINGS_WIDTH), width: SETTINGS_WIDTH });

  const placed = Math.max(0, Math.min(visible, chips.length));
  let lastTier: AlertTier | null = null;
  for (let i = 0; i < placed; i++) {
    const chip = chips[i];
    let margin = lastTier === null ? afterNonChip : gap;
    if (lastTier !== null && chip.tier !== lastTier) {
      items.push({
        kind: "separator",
        left: placeAt(separator.left, SEPARATOR_WIDTH),
        width: SEPARATOR_WIDTH,
      });
      edge += separator.right;
      margin = afterNonChip;
    }
    const width = chipWidth(chip.count);
    items.push({ kind: "chip", chip, left: placeAt(margin, width), width, zIndex: placed - i });
    lastTier = chip.tier;
  }

  if (collapsed > 0) {
    items.push({
      kind: "tail",
      collapsed,
      left: placeAt(placed > 0 ? gap : afterNonChip, PLUS_N_WIDTH),
      width: PLUS_N_WIDTH,
    });
  }

  return items;
}

/**
 * Place the ordered `chips` — one entry per chip, in the order the caller renders them, critical
 * tier first by that caller's own contract — into `availableWidth` CSS pixels.
 *
 * The ordered sequence itself is the argument rather than a set of bare counts because every number
 * this needs is a property of that sequence and none is safely restatable beside it: how many
 * leading chips are critical (a PREFIX fact, since the collapse loop protects indices
 * `0..criticalCount`, not a set of ids anywhere in the list), where the tier boundaries fall inside
 * any given prefix (which decides where the separators go, and so how wide the run really is), and
 * how wide each chip is (`chipWidth` of its own count — charging every chip the widest figure
 * collapses runs that had room to sit spaced).
 *
 * Candidate steps are tried in order, most generous first, and the first one whose laid-out right
 * edge fits is the answer: the three fixed-gap steps with every chip showing, then chips dropped
 * from the END of the list (least severe first) with a "+N" naming them, never below the critical
 * prefix, then the critical tier alone with its "+N", then the critical tier squeezed to
 * `criticalStackOverlap`. Each candidate is measured by actually placing it, so the separators, the
 * tail and the control are paid for by construction rather than by a reservation kept in step by
 * hand.
 *
 * If nothing fits, the run places the settings control and nothing else — the floor below which
 * overflowing the map is worse than showing nothing (docs/active/gameplay/alert-bar.md → "Placement
 * and behaviour"). The control is the one item exempt from `availableWidth`: it is the run's only
 * entry point back to its own category checkboxes, so it renders at every width, including one too
 * narrow for it.
 */
export function layoutRun<T extends RunChip>(
  chips: readonly T[],
  availableWidth: number,
): RunLayout<T> {
  const total = chips.length;

  // The critical tier is a PREFIX of the run, not a subset scattered through it — the caller orders
  // by tier before calling. Counting it here, off the same sequence every candidate is placed from,
  // is what makes that invariant this function's own rather than a promise its caller has to keep.
  let criticalCount = 0;
  while (criticalCount < total && chips[criticalCount].tier === "critical") criticalCount += 1;

  const steps: { visible: number; gap: number; collapsed: number }[] = [
    { visible: total, gap: SPACED_GAP, collapsed: 0 },
    { visible: total, gap: OVERLAP_NOMINAL, collapsed: 0 },
    { visible: total, gap: OVERLAP_FLOOR, collapsed: 0 },
  ];
  for (let visible = total - 1; visible > criticalCount; visible--) {
    steps.push({ visible, gap: OVERLAP_FLOOR, collapsed: total - visible });
  }
  steps.push({ visible: criticalCount, gap: OVERLAP_FLOOR, collapsed: total - criticalCount });
  steps.push({
    visible: criticalCount,
    gap: criticalStackOverlap(chips, criticalCount),
    collapsed: total - criticalCount,
  });

  for (const step of steps) {
    const items = placeRun(chips, step.visible, step.gap, step.collapsed);
    const contentWidth = rightEdge(items);
    if (contentWidth <= availableWidth) {
      return { items, overlapping: isOverlapping(step.gap), contentWidth };
    }
  }

  const items = placeRun(chips, 0, 0, 0);
  return { items, overlapping: false, contentWidth: rightEdge(items) };
}
