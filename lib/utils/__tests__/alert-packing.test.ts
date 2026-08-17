import { describe, it, expect } from "vitest";
import {
  packRun,
  CHIP_WIDTH,
  SPACED_GAP,
  OVERLAP_NOMINAL,
  OVERLAP_FLOOR,
  CRITICAL_STACK_OVERLAP,
  PLUS_N_WIDTH,
  isOverlapping,
  chipMarginLeft,
  separatorMargins,
  stackZIndex,
} from "@/lib/utils/alert-packing";

/** The same width algebra `packRun` itself uses, so a test can compute an exact boundary rather
 *  than guess a width that's merely "probably enough". */
function widthFor(n: number, gap: number): number {
  if (n <= 0) return 0;
  return n * CHIP_WIDTH + Math.max(0, n - 1) * gap;
}

describe("packRun — the three fixed-gap steps, tried in order", () => {
  it("packs spaced when the run comfortably fits", () => {
    const need = widthFor(3, SPACED_GAP);
    expect(packRun(3, need, 1)).toEqual({ step: "spaced", visible: 3, collapsed: 0, gap: SPACED_GAP });
  });

  it("falls back to overlap8 exactly when spaced no longer fits but overlap8 does", () => {
    const needSpaced = widthFor(5, SPACED_GAP);
    const needOverlap8 = widthFor(5, OVERLAP_NOMINAL);
    const width = needOverlap8; // fits overlap8, and is below needSpaced (overlap8 < spaced width)
    expect(width).toBeLessThan(needSpaced);
    expect(packRun(5, width, 1)).toEqual({ step: "overlap8", visible: 5, collapsed: 0, gap: OVERLAP_NOMINAL });
  });

  it("tightens to overlap16 once overlap8 no longer fits", () => {
    const needOverlap8 = widthFor(5, OVERLAP_NOMINAL);
    const needOverlap16 = widthFor(5, OVERLAP_FLOOR);
    const width = needOverlap16;
    expect(width).toBeLessThan(needOverlap8);
    expect(packRun(5, width, 1)).toEqual({ step: "overlap16", visible: 5, collapsed: 0, gap: OVERLAP_FLOOR });
  });
});

describe("packRun — past the floor, the least-severe tail collapses into a +N", () => {
  it("drops exactly as many trailing chips as needed to fit at the floor plus a +N reserve", () => {
    // 6 chips, 2 critical. Dropping to 3 (2 critical + 1 important) plus the +N reserve fits at
    // the floor gap — the width is derived from the same constants packRun itself uses, so this
    // stays correct across a CHIP_WIDTH change rather than pinning a stale literal.
    const width = widthFor(3, OVERLAP_FLOOR) + PLUS_N_WIDTH;
    expect(packRun(6, width, 2)).toEqual({ step: "collapse", visible: 3, collapsed: 3, gap: OVERLAP_FLOOR });
  });

  it("stops dropping at exactly criticalCount — never fewer visible than the critical tier", () => {
    // 6 chips, 4 critical. Only 5 chips (1 dropped) doesn't fit; 4 (the critical tier alone) does.
    const width = widthFor(4, OVERLAP_FLOOR) + PLUS_N_WIDTH;
    expect(widthFor(5, OVERLAP_FLOOR) + PLUS_N_WIDTH).toBeGreaterThan(width);
    expect(packRun(6, width, 4)).toEqual({ step: "collapse", visible: 4, collapsed: 2, gap: OVERLAP_FLOOR });
  });
});

describe("packRun — the critical tier stacks past the ordinary floor before it collapses", () => {
  it("squeezes the critical tier past OVERLAP_FLOOR when the floor pack plus a +N doesn't fit", () => {
    // 5 chips, 3 critical. The floor pack for the critical tier + a +N needs more than stacking all
    // the way to CRITICAL_STACK_OVERLAP does. A width in between still shows all 3 criticals
    // (packed tighter than the ordinary floor) rather than dropping one.
    const needFloor = widthFor(3, OVERLAP_FLOOR) + PLUS_N_WIDTH;
    const needStacked = widthFor(3, CRITICAL_STACK_OVERLAP) + PLUS_N_WIDTH;
    const width = needStacked + 10;
    expect(width).toBeLessThan(needFloor);
    expect(packRun(5, width, 3)).toEqual({
      step: "collapse",
      visible: 3,
      collapsed: 2,
      gap: CRITICAL_STACK_OVERLAP,
    });
  });
});

describe("packRun — below the width that fits the critical tier plus a +N, the run renders nothing", () => {
  it("renders nothing one pixel below the maximally-stacked critical-tier-plus-+N threshold", () => {
    const threshold = widthFor(3, CRITICAL_STACK_OVERLAP) + PLUS_N_WIDTH;
    expect(packRun(5, threshold, 3)).toEqual({
      step: "collapse",
      visible: 3,
      collapsed: 2,
      gap: CRITICAL_STACK_OVERLAP,
    });
    expect(packRun(5, threshold - 1, 3)).toEqual({ step: "collapse", visible: 0, collapsed: 0, gap: 0 });
  });

  it("renders nothing when even the fully-stacked critical tier alone (no other chips at all) doesn't fit", () => {
    // 4 chips, all critical — nothing to collapse into a +N, so the reserve is never added, but
    // the tier still doesn't fit even fully stacked.
    const stackedAll = widthFor(4, CRITICAL_STACK_OVERLAP); // no +N since nothing collapses
    expect(packRun(4, stackedAll - 1, 4)).toEqual({ step: "collapse", visible: 0, collapsed: 0, gap: 0 });
    expect(packRun(4, stackedAll, 4)).toEqual({
      step: "collapse",
      visible: 4,
      collapsed: 0,
      gap: CRITICAL_STACK_OVERLAP,
    });
  });
});

describe("packRun — never places a critical chip in the collapsed tail, at any width", () => {
  it("visible is always 0 or at least criticalCount, across a sweep of widths", () => {
    const chipCount = 9;
    const criticalCount = 3;
    for (let width = 0; width <= 700; width += 7) {
      const result = packRun(chipCount, width, criticalCount);
      expect(result.visible === 0 || result.visible >= criticalCount).toBe(true);
      // visible + collapsed always accounts for every chip, or nothing renders at all.
      expect(result.visible === 0 ? result.collapsed === 0 : result.visible + result.collapsed === chipCount).toBe(
        true,
      );
    }
  });
});

describe("packRun — degenerate input", () => {
  it("no chips packs nothing", () => {
    expect(packRun(0, 1000, 0)).toEqual({ step: "collapse", visible: 0, collapsed: 0, gap: 0 });
  });

  it("non-positive available width packs nothing, even for one chip", () => {
    expect(packRun(1, 0, 1)).toEqual({ step: "collapse", visible: 0, collapsed: 0, gap: 0 });
    expect(packRun(1, -50, 1)).toEqual({ step: "collapse", visible: 0, collapsed: 0, gap: 0 });
  });
});

describe("chipMarginLeft / separatorMargins / isOverlapping — the real CSS the four packing steps render", () => {
  it("the first item in the run never gets a margin, at any gap", () => {
    expect(chipMarginLeft(SPACED_GAP, "first")).toBe(0);
    expect(chipMarginLeft(OVERLAP_FLOOR, "first")).toBe(0);
  });

  it("a chip after a chip always uses the packing gap as-is, spaced or overlapping", () => {
    expect(chipMarginLeft(SPACED_GAP, "after-chip")).toBe(SPACED_GAP);
    expect(chipMarginLeft(OVERLAP_NOMINAL, "after-chip")).toBe(OVERLAP_NOMINAL);
    expect(chipMarginLeft(OVERLAP_FLOOR, "after-chip")).toBe(OVERLAP_FLOOR);
    expect(chipMarginLeft(CRITICAL_STACK_OVERLAP, "after-chip")).toBe(CRITICAL_STACK_OVERLAP);
  });

  it("a chip right after the tier separator drops the overlap to 0 once overlapping, but keeps the spaced gap while not", () => {
    expect(chipMarginLeft(SPACED_GAP, "after-separator")).toBe(SPACED_GAP);
    expect(chipMarginLeft(OVERLAP_NOMINAL, "after-separator")).toBe(0);
    expect(chipMarginLeft(OVERLAP_FLOOR, "after-separator")).toBe(0);
    expect(chipMarginLeft(CRITICAL_STACK_OVERLAP, "after-separator")).toBe(0);
  });

  it("isOverlapping is true for every overlap step and false only for the spaced gap", () => {
    expect(isOverlapping(SPACED_GAP)).toBe(false);
    expect(isOverlapping(OVERLAP_NOMINAL)).toBe(true);
    expect(isOverlapping(OVERLAP_FLOOR)).toBe(true);
    expect(isOverlapping(CRITICAL_STACK_OVERLAP)).toBe(true);
  });

  it("the tier separator's margins switch from the resting symmetric pair to the prototype's asymmetric one once overlapping", () => {
    expect(separatorMargins(SPACED_GAP)).toEqual({ left: 3, right: 3 });
    expect(separatorMargins(OVERLAP_NOMINAL)).toEqual({ left: 9, right: 5 });
    expect(separatorMargins(CRITICAL_STACK_OVERLAP)).toEqual({ left: 9, right: 5 });
  });
});

describe("stackZIndex — the leftmost, most severe chip sits on top of the stack", () => {
  it("index 0 (the most severe chip) always has the highest resting z-index", () => {
    expect(stackZIndex(0, 5)).toBe(5);
    expect(stackZIndex(4, 5)).toBe(1);
  });

  it("every chip in a run has a distinct, strictly-descending resting z-index front to back", () => {
    const total = 6;
    const zs = Array.from({ length: total }, (_, i) => stackZIndex(i, total));
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]).toBeLessThan(zs[i - 1]);
    }
  });
});
