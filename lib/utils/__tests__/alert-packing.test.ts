import { describe, it, expect } from "vitest";
import {
  layoutRun,
  chipWidth,
  criticalStackOverlap,
  CHIP_BASE_WIDTH,
  CHIP_DIGIT_WIDTH,
  CRITICAL_STACK_SLIVER,
  SPACED_GAP,
  OVERLAP_NOMINAL,
  OVERLAP_FLOOR,
  PLUS_N_WIDTH,
  SETTINGS_WIDTH,
  SEPARATOR_WIDTH,
  RUN_HEIGHT,
  type PlacedItem,
  type RunChip,
  type RunLayout,
} from "@/lib/utils/alert-packing";
import type { AlertTier } from "@/lib/types/alerts";

/**
 * These tests read the placed item list back and check properties OF it. They deliberately do not
 * restate the width arithmetic `layoutRun` uses: a check re-derived from the same reasoning as the
 * model it is checking agrees with that model's blind spots too, which is exactly how a run whose
 * width model had forgotten the tier separators kept passing.
 *
 * So the boundary tests below ask the layout where its own boundaries are (`narrowestWidthWhere`)
 * and then assert what it draws on either side of them, and the sweep tests assert invariants —
 * things that must hold of every layout at every width, none of which can be satisfied by getting
 * the arithmetic consistently wrong.
 */

type Items = readonly PlacedItem<RunChip>[];
type ChipItem = Extract<PlacedItem<RunChip>, { kind: "chip" }>;
type TailItem = Extract<PlacedItem<RunChip>, { kind: "tail" }>;

function placedChips(items: Items): ChipItem[] {
  return items.flatMap((item) => (item.kind === "chip" ? [item] : []));
}

function placedSeparators(items: Items): PlacedItem<RunChip>[] {
  return items.flatMap((item) => (item.kind === "separator" ? [item] : []));
}

function placedTail(items: Items): TailItem | null {
  const tails = items.flatMap((item) => (item.kind === "tail" ? [item] : []));
  return tails.length === 1 ? tails[0] : null;
}

/** The gap the run actually realised between the first two chips that sit side by side with no
 *  separator between them — negative where they overlap. The packing step, read off the placement
 *  rather than off the constant the placement was asked for. `null` when the run drew fewer than two
 *  adjacent chips. */
function chipGap(items: Items): number | null {
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1];
    const item = items[i];
    if (before.kind === "chip" && item.kind === "chip") return item.left - (before.left + before.width);
  }
  return null;
}

/** An ordered run of `chipCount` chips whose first `criticalCount` are critical — the shape
 *  `AlertRunChips` (`components/alerts/alert-run.tsx`) hands the layout. Anything past the critical
 *  prefix is `important`, so such a run carries exactly one tier boundary (none when it is all one
 *  tier). `count` defaults to a three-digit one, the widest a chip realistically gets. */
function run(chipCount: number, criticalCount: number, count = 253): RunChip[] {
  return Array.from({ length: chipCount }, (_, i): RunChip => ({
    tier: i < criticalCount ? "critical" : "important",
    count,
  }));
}

/** An ordered run stated as explicit tier/count pairs, for the shapes the two-number `run` helper
 *  above cannot express. */
function chipsOf(...pairs: readonly (readonly [AlertTier, number])[]): RunChip[] {
  return pairs.map(([tier, count]) => ({ tier, count }));
}

function describeChips(chips: readonly RunChip[]): string {
  if (chips.length === 0) return "(no chips)";
  return chips.map((chip) => `${chip.tier[0]}${chip.count}`).join(" ");
}

/**
 * The shapes every invariant below is checked against — chip counts from none to ten, all three tier
 * mixes, critical prefixes of every length including none and all, and counts at one, two and three
 * digits mixed WITHIN a run as well as across them. The mixed-width runs are the ones that matter:
 * a per-chip width model only differs from a flat one where a prefix sum is not a multiple of any
 * single chip's width, and the deepest overlap the run allows is solved against the narrowest chip
 * in a stack, which a uniform run can never distinguish from the widest.
 */
const SWEEP_SHAPES: RunChip[][] = [
  [],
  chipsOf(["critical", 3]),
  chipsOf(["critical", 7], ["critical", 9]),
  chipsOf(["critical", 3], ["important", 47], ["info", 250]),
  chipsOf(["critical", 1], ["critical", 250], ["important", 9], ["important", 88], ["info", 4]),
  chipsOf(
    ["critical", 120],
    ["critical", 7],
    ["critical", 33],
    ["important", 999],
    ["info", 2],
    ["info", 61],
  ),
  chipsOf(["critical", 4], ["critical", 1], ["critical", 999], ["important", 2], ["info", 33], ["info", 7]),
  chipsOf(["important", 5], ["important", 5], ["info", 5]),
  chipsOf(["info", 100], ["info", 100], ["info", 100]),
  run(9, 3),
  run(10, 0, 3),
  run(10, 10, 3),
  run(6, 6, 1),
  run(4, 4, 253),
];

const SWEEP_MAX_WIDTH = 760;

/**
 * Every layout in the sweep, checked by `inspect`, which returns a description of what is wrong or
 * `null`. Collected rather than asserted one at a time so a failure names the shape and the width it
 * happened at instead of the thousandth `expect` in a loop.
 */
function violations(
  inspect: (layout: RunLayout<RunChip>, chips: readonly RunChip[], width: number) => string | null,
): string[] {
  const found: string[] = [];
  for (const chips of SWEEP_SHAPES) {
    for (let width = 0; width <= SWEEP_MAX_WIDTH; width++) {
      const problem = inspect(layoutRun(chips, width), chips, width);
      if (problem !== null) {
        found.push(`[${describeChips(chips)}] at width ${width}: ${problem}`);
        if (found.length >= 5) return found;
      }
    }
  }
  return found;
}

/** The narrowest `availableWidth` at which the run lays out the way `holds` describes — asked of the
 *  layout itself, so a boundary test never has to restate the width model to say where a boundary
 *  is. */
function narrowestWidthWhere(
  chips: readonly RunChip[],
  holds: (layout: RunLayout<RunChip>) => boolean,
): number {
  for (let width = 0; width <= 1400; width++) {
    if (holds(layoutRun(chips, width))) return width;
  }
  throw new Error(`no width in 0..1400 lays out [${describeChips(chips)}] that way`);
}

describe("layoutRun — invariants that hold of every layout at every width", () => {
  it("never places anything but the control outside availableWidth", () => {
    // The control is the one item exempt by contract: it renders at every width, including one too
    // narrow for it, because it is the only way back into the categories hiding everything else.
    // Everything else the run draws has to fit, or it overflows the map.
    expect(
      violations((layout, _chips, width) => {
        if (layout.items.length <= 1) return null;
        if (layout.contentWidth > width) {
          return `contentWidth ${layout.contentWidth} exceeds the ${width} available`;
        }
        for (const item of layout.items) {
          if (item.left + item.width > width) {
            return `${item.kind} ends at ${item.left + item.width}, past the ${width} available`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("never places an item to the left of the item before it", () => {
    // A negative per-chip advance draws the next chip BEHIND the one before it, and at the front of
    // the run, on top of the settings control. Ordering is a property of the placement itself here,
    // not something each gap rule has to be trusted to preserve.
    expect(
      violations((layout) => {
        for (let i = 1; i < layout.items.length; i++) {
          const before = layout.items[i - 1];
          const item = layout.items[i];
          if (item.left < before.left) {
            return `${item.kind} at ${item.left} starts left of the ${before.kind} at ${before.left}`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("leaves at least a sliver of every chip showing past whatever it placed next", () => {
    // Stronger than mere ordering, and the reason the deepest overlap is solved against the
    // narrowest chip in the stack: an advance of zero is monotonic and still draws one chip exactly
    // on top of another, which reads as a single chip rather than a stack.
    expect(
      violations((layout) => {
        for (let i = 1; i < layout.items.length; i++) {
          const before = layout.items[i - 1];
          const item = layout.items[i];
          if (before.kind !== "chip") continue;
          if (item.left - before.left < CRITICAL_STACK_SLIVER) {
            return `only ${item.left - before.left}px of a chip shows past the ${item.kind} after it`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("always leads with the settings control, at offset 0, at every width", () => {
    expect(
      violations((layout) => {
        const first = layout.items[0];
        if (layout.items.length === 0) return "the run placed nothing at all";
        if (first.kind !== "control") return `the run leads with a ${first.kind}`;
        if (first.left !== 0) return `the control sits at ${first.left} rather than 0`;
        if (first.width !== SETTINGS_WIDTH) return `the control is ${first.width}px wide`;
        const controls = layout.items.filter((item) => item.kind === "control").length;
        if (controls !== 1) return `${controls} controls placed`;
        return null;
      }),
    ).toEqual([]);
  });

  it("never folds a critical chip into the collapsed tail", () => {
    expect(
      violations((layout, chips) => {
        const tail = placedTail(layout.items);
        if (tail === null) return null;
        const folded = chips.slice(placedChips(layout.items).length);
        if (folded.length !== tail.collapsed) {
          return `the tail names ${tail.collapsed} of the ${folded.length} chips it stands for`;
        }
        const critical = folded.find((chip) => chip.tier === "critical");
        return critical === undefined ? null : `folded a critical chip (count ${critical.count})`;
      }),
    ).toEqual([]);
  });

  it("shows the chips it shows as a prefix of the run, in the caller's own order", () => {
    // The critical-tier guarantee above is a statement about a PREFIX, so it only means anything if
    // what the run draws really is the front of the list the caller handed it.
    expect(
      violations((layout, chips) => {
        const placed = placedChips(layout.items);
        for (let i = 0; i < placed.length; i++) {
          if (placed[i].chip !== chips[i]) return `chip ${i} is not the caller's chip ${i}`;
          if (placed[i].width !== chipWidth(chips[i].count)) {
            return `chip ${i} placed at ${placed[i].width}px, not the ${chipWidth(chips[i].count)}px it draws`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("accounts for contentWidth, and for every chip, with something it actually placed", () => {
    // Nothing reserved that is not placed, and nothing dropped that is not named: the run either
    // places every chip or names the remainder in the tail, and the width it claims is the width its
    // own items reach.
    expect(
      violations((layout, chips) => {
        let edge = 0;
        for (const item of layout.items) edge = Math.max(edge, item.left + item.width);
        if (edge !== layout.contentWidth) {
          return `contentWidth is ${layout.contentWidth} but the items reach ${edge}`;
        }
        const tail = placedTail(layout.items);
        const accounted = placedChips(layout.items).length + (tail?.collapsed ?? 0);
        if (layout.items.length === 1) {
          return accounted === 0 ? null : "a control-only run still accounted for chips";
        }
        if (accounted !== chips.length) {
          return `${accounted} of ${chips.length} chips are either drawn or named in the tail`;
        }
        if (tail !== null && tail.width !== PLUS_N_WIDTH) return `the tail is ${tail.width}px wide`;
        return null;
      }),
    ).toEqual([]);
  });

  it("never gives up on a run it has room to name, when no chip in it is critical", () => {
    // Giving up entirely is only allowed below the width that fits anything at all. With nothing
    // critical firing there is no chip the run is obliged to keep, so the cheapest thing it can draw
    // is the control plus the "+N" naming every category — and anywhere it has room for that and
    // draws the control alone, the player is looking at a bare gear while N categories are live.
    expect(
      violations((layout, chips, width) => {
        if (chips.length === 0) return null;
        if (chips.some((chip) => chip.tier === "critical")) return null;
        if (width < SETTINGS_WIDTH + PLUS_N_WIDTH) return null;
        return layout.items.length > 1 ? null : "drew the control alone with room for a +N tail";
      }),
    ).toEqual([]);
  });

  it("draws a hairline at exactly each tier boundary it placed, and nowhere else", () => {
    // The disagreement that started this: the width model counted no separators while the run drew
    // one per tier change, so a three-tier run overran its span by both of them. Reading the drawn
    // separators back off the same list the fit check measured is what makes that impossible.
    expect(
      violations((layout) => {
        const items = layout.items;
        const chips = placedChips(items);
        let boundaries = 0;
        for (let i = 1; i < chips.length; i++) {
          if (chips[i].chip.tier !== chips[i - 1].chip.tier) boundaries += 1;
        }
        const separators = placedSeparators(items);
        if (separators.length !== boundaries) {
          return `${separators.length} separators drawn for ${boundaries} tier changes`;
        }
        if (separators.some((separator) => separator.width !== SEPARATOR_WIDTH)) {
          return "a separator is not a one-pixel hairline";
        }
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== "separator") continue;
          if (i === 0 || i + 1 >= items.length) return "a separator sits at the edge of the run";
          const before = items[i - 1];
          const after = items[i + 1];
          if (before.kind !== "chip" || after.kind !== "chip") {
            return "a separator does not sit between two chips";
          }
          if (before.chip.tier === after.chip.tier) return "a separator sits inside one tier";
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("gives the leftmost, most severe chip the highest resting stack order", () => {
    expect(
      violations((layout) => {
        const chips = placedChips(layout.items);
        for (let i = 0; i < chips.length; i++) {
          if (chips[i].zIndex < 1) return `chip ${i} rests at z-index ${chips[i].zIndex}`;
          if (i > 0 && chips[i].zIndex >= chips[i - 1].zIndex) {
            return `chip ${i} rests at or above the chip to its left`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("reports overlapping exactly when the chips it drew actually overlap", () => {
    expect(
      violations((layout) => {
        const advance = chipGap(layout.items);
        if (advance === null) return null;
        const overlaps = advance < 0;
        if (overlaps !== layout.overlapping) {
          return `reports overlapping=${layout.overlapping} at a realised advance of ${advance}`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("never packs a run worse as the space for it grows", () => {
    // The cascade is only well-formed if each step it falls back to asks for less room than the step
    // before it. If one ever asked for more, a wider run could show fewer chips or overlap harder
    // than a narrower one.
    const problems: string[] = [];
    for (const chips of SWEEP_SHAPES) {
      let lastCount = -1;
      let lastAdvance: number | null = null;
      for (let width = 0; width <= SWEEP_MAX_WIDTH; width++) {
        const layout = layoutRun(chips, width);
        const count = placedChips(layout.items).length;
        const advance = chipGap(layout.items);
        if (count < lastCount) {
          problems.push(`[${describeChips(chips)}] drops from ${lastCount} to ${count} chips at ${width}`);
        }
        if (advance !== null && lastAdvance !== null && advance < lastAdvance) {
          problems.push(`[${describeChips(chips)}] tightens from ${lastAdvance} to ${advance} at ${width}`);
        }
        lastCount = count;
        lastAdvance = advance;
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

describe("layoutRun — the three fixed-gap steps, tried in order", () => {
  it("sits spaced while the run fits, and takes the nominal overlap one pixel below that", () => {
    const chips = run(5, 1);
    const spaced = narrowestWidthWhere(chips, (layout) => chipGap(layout.items) === SPACED_GAP);

    const fits = layoutRun(chips, spaced);
    expect(placedChips(fits.items)).toHaveLength(5);
    expect(fits.overlapping).toBe(false);
    expect(placedTail(fits.items)).toBeNull();

    const tighter = layoutRun(chips, spaced - 1);
    expect(chipGap(tighter.items)).toBe(OVERLAP_NOMINAL);
    expect(placedChips(tighter.items)).toHaveLength(5);
    expect(tighter.overlapping).toBe(true);
  });

  it("tightens to the floor overlap one pixel below the nominal overlap's own narrowest fit", () => {
    const chips = run(5, 1);
    const nominal = narrowestWidthWhere(chips, (layout) => chipGap(layout.items) === OVERLAP_NOMINAL);

    expect(placedChips(layoutRun(chips, nominal).items)).toHaveLength(5);

    const tighter = layoutRun(chips, nominal - 1);
    expect(chipGap(tighter.items)).toBe(OVERLAP_FLOOR);
    expect(placedChips(tighter.items)).toHaveLength(5);
  });

  it("gives up a chip only below the floor overlap's own narrowest fit", () => {
    const chips = run(5, 1);
    const floor = narrowestWidthWhere(
      chips,
      (layout) => chipGap(layout.items) === OVERLAP_FLOOR && placedChips(layout.items).length === 5,
    );

    expect(placedTail(layoutRun(chips, floor).items)).toBeNull();

    const tighter = layoutRun(chips, floor - 1);
    const drawn = placedChips(tighter.items).length;
    expect(drawn).toBeLessThan(5);
    expect(placedTail(tighter.items)?.collapsed).toBe(5 - drawn);
  });
});

describe("layoutRun — past the floor, the least-severe tail collapses into a +N", () => {
  it("gives up chips one at a time from the least-severe end", () => {
    const chips = run(6, 2);
    for (let drawn = 5; drawn >= 3; drawn--) {
      const width = narrowestWidthWhere(chips, (layout) => placedChips(layout.items).length === drawn);
      const layout = layoutRun(chips, width);
      expect(placedChips(layout.items)).toHaveLength(drawn);
      expect(placedTail(layout.items)?.collapsed).toBe(6 - drawn);
      // Still the ordinary floor: chips are given up one at a time BEFORE the run squeezes past it.
      expect(chipGap(layout.items)).toBe(OVERLAP_FLOOR);
    }
  });

  it("stops at the critical prefix and stacks it past the floor rather than folding one away", () => {
    const chips = run(5, 3);
    const width = narrowestWidthWhere(chips, (layout) => placedChips(layout.items).length === 3);
    const layout = layoutRun(chips, width);

    expect(placedChips(layout.items)).toHaveLength(3);
    expect(placedTail(layout.items)?.collapsed).toBe(2);
    // Tighter than the ordinary floor, which is what "stacks past 16px rather than collapse" means,
    // and tight enough that each critical chip shows exactly its sliver past the one after it.
    expect(chipGap(layout.items)).toBeLessThan(OVERLAP_FLOOR);
    const placed = placedChips(layout.items);
    expect(placed[1].left - placed[0].left).toBe(CRITICAL_STACK_SLIVER);
  });

  it("names what it dropped even when no chip at all fits, so the +N still draws", () => {
    // No critical category firing — the ordinary case at a narrow viewport — so there is no chip the
    // run is obliged to keep, and every one of them folds into the tail.
    const chips = run(4, 0);
    const width = narrowestWidthWhere(chips, (layout) => placedTail(layout.items) !== null);
    const layout = layoutRun(chips, width);

    expect(placedChips(layout.items)).toHaveLength(0);
    expect(placedTail(layout.items)?.collapsed).toBe(4);
  });

  it("derives the critical prefix from the run's own order, not from how many criticals it holds", () => {
    // A run whose critical chips are NOT a prefix (which the caller's tier sort never produces) must
    // still never fold a chip the layout is protecting: only the leading critical chip counts.
    const chips = chipsOf(["critical", 12], ["important", 4], ["critical", 7], ["info", 200]);
    const width = narrowestWidthWhere(chips, (layout) => placedChips(layout.items).length === 1);
    const layout = layoutRun(chips, width);

    expect(placedChips(layout.items)).toHaveLength(1);
    expect(placedTail(layout.items)?.collapsed).toBe(3);
  });
});

describe("layoutRun — below the width that fits the critical tier plus a +N, only the control draws", () => {
  it("places the control alone one pixel below the maximally-stacked threshold", () => {
    const chips = run(5, 3);
    const threshold = narrowestWidthWhere(chips, (layout) => layout.items.length > 1);

    expect(placedChips(layoutRun(chips, threshold).items)).toHaveLength(3);

    const below = layoutRun(chips, threshold - 1);
    expect(below.items).toHaveLength(1);
    expect(below.items[0].kind).toBe("control");
    expect(below.overlapping).toBe(false);
  });

  it("places the control alone when even the fully-stacked critical tier by itself doesn't fit", () => {
    // Every chip critical, so there is nothing to fold into a tail and no separator either — the run
    // has already spent every step it has.
    const chips = run(4, 4);
    const threshold = narrowestWidthWhere(chips, (layout) => layout.items.length > 1);

    expect(placedChips(layoutRun(chips, threshold).items)).toHaveLength(4);
    expect(placedTail(layoutRun(chips, threshold).items)).toBeNull();
    expect(layoutRun(chips, threshold - 1).items).toHaveLength(1);
  });
});

describe("criticalStackOverlap — the stack is clamped against the narrowest chip in it", () => {
  it("keeps every chip of a single-digit critical stack showing its own sliver", () => {
    // An overlap anchored to the widest a chip could theoretically get overlaps a single-digit chip
    // by more than its own width, drawing the second chip to the LEFT of the first and over the
    // settings control. Solved against the narrowest chip actually being stacked, the advance is the
    // sliver, whatever counts the run happens to be showing.
    const chips = run(4, 4, 3);
    const width = narrowestWidthWhere(chips, (layout) => placedChips(layout.items).length === 4);
    const placed = placedChips(layoutRun(chips, width).items);

    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].left - placed[i - 1].left).toBe(CRITICAL_STACK_SLIVER);
    }
    expect(criticalStackOverlap(chips, 4)).toBe(-(chipWidth(3) - CRITICAL_STACK_SLIVER));
  });

  it("solves against the narrowest member when the stack mixes chip widths", () => {
    const chips = chipsOf(["critical", 253], ["critical", 4], ["critical", 88]);
    expect(criticalStackOverlap(chips, 3)).toBe(-(chipWidth(4) - CRITICAL_STACK_SLIVER));
    expect(criticalStackOverlap(chips, 1)).toBe(-(chipWidth(253) - CRITICAL_STACK_SLIVER));
  });

  it("is never looser than the ordinary overlap floor it is reached from", () => {
    expect(criticalStackOverlap([], 0)).toBe(OVERLAP_FLOOR);
    expect(criticalStackOverlap(run(3, 3, 1), 3)).toBeLessThanOrEqual(OVERLAP_FLOOR);
    expect(criticalStackOverlap(run(3, 3, 253), 3)).toBeLessThanOrEqual(OVERLAP_FLOOR);
  });
});

describe("layoutRun — budgets each chip at its own width, not at the worst case", () => {
  it("draws every chip of a single-digit run at a width the same run of three-digit counts collapses in", () => {
    // The two runs below are the same ten one-tier chips at the same width; only the counts differ,
    // which is exactly the difference a flat per-chip budget cannot see.
    const narrow = run(10, 0, 3);
    const wide = run(10, 0, 253);
    const width = narrowestWidthWhere(narrow, (layout) => placedChips(layout.items).length === 10);

    expect(placedChips(layoutRun(narrow, width).items)).toHaveLength(10);

    const wideLayout = layoutRun(wide, width);
    expect(placedChips(wideLayout.items).length).toBeLessThan(10);
    expect(placedTail(wideLayout.items)?.collapsed).toBeGreaterThan(0);
  });

  it("keeps a narrow-count run spaced at a width that forces the same run of wide counts to overlap", () => {
    const narrow = run(6, 0, 3);
    const wide = run(6, 0, 253);
    const width = narrowestWidthWhere(
      narrow,
      (layout) => !layout.overlapping && placedChips(layout.items).length === 6,
    );

    expect(layoutRun(narrow, width).overlapping).toBe(false);
    expect(layoutRun(wide, width).overlapping).toBe(true);
  });
});

describe("layoutRun — degenerate input", () => {
  it("places the control alone for a run with no chips", () => {
    const layout = layoutRun([], 1000);
    expect(layout.items).toEqual([{ kind: "control", left: 0, width: SETTINGS_WIDTH }]);
    expect(layout.contentWidth).toBe(SETTINGS_WIDTH);
    expect(layout.overlapping).toBe(false);
  });

  it("still places the control at a non-positive available width", () => {
    for (const width of [0, -50]) {
      const layout = layoutRun(run(1, 1), width);
      expect(layout.items).toHaveLength(1);
      expect(layout.items[0].kind).toBe("control");
    }
  });
});

describe("chipWidth — a chip costs what its own count costs", () => {
  it("is the shell plus one glyph per rendered digit, at one, two and three digits", () => {
    expect(chipWidth(3)).toBe(54);
    expect(chipWidth(42)).toBe(62);
    expect(chipWidth(253)).toBe(70);
  });

  it("is exactly the digit-width apart between adjacent digit counts", () => {
    // The gradient, not just the three points: a base/per-digit pair that happened to hit 54/62/70 by
    // other arithmetic would still have to be linear in the digit count to be this.
    expect(chipWidth(42) - chipWidth(3)).toBe(CHIP_DIGIT_WIDTH);
    expect(chipWidth(253) - chipWidth(42)).toBe(CHIP_DIGIT_WIDTH);
    expect(chipWidth(1) - CHIP_DIGIT_WIDTH).toBe(CHIP_BASE_WIDTH);
  });

  it("charges one glyph, never zero and never NaN, for a count that is not a positive integer", () => {
    // A chip always draws something, and a NaN width would propagate through every comparison in the
    // layout and silently certify any run as fitting any width.
    for (const count of [0, -1, -253, 0.5, 3.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chipWidth(count)).toBe(chipWidth(1));
      expect(Number.isFinite(chipWidth(count))).toBe(true);
      expect(chipWidth(count)).toBeGreaterThan(0);
    }
  });
});

describe("the run's authored footprints", () => {
  it("pins the run's height to the chip shell it centres every item in", () => {
    // `AlertChip`'s `h-[26px]`. The run's items are absolutely positioned and contribute no height,
    // so this is the only thing holding the run's own box open.
    expect(RUN_HEIGHT).toBe(26);
  });

  it("keeps the +N tail narrower than the narrowest chip it can replace", () => {
    // Folding a chip into the tail has to leave the run NARROWER than keeping it, or a collapse step
    // could ask for more room than the step it falls back from and the cascade would stop being
    // ordered by generosity.
    expect(PLUS_N_WIDTH).toBeLessThan(chipWidth(1));
  });
});
