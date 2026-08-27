import { describe, it, expect } from "vitest";
import { emptyResourceVector } from "@/lib/engine/resources";
import { DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from "@/lib/constants/bodies";
import { ringLayout } from "../ring-layout";
import type { BodyView } from "@/lib/types/api";

// `detail-panel.tsx`'s panel is a fixed `w-[560px]` column whose body slot subtracts `px-4`
// (16px each side) plus a scrollbar gutter — the ring diagram's real usable square is smaller
// than 560px. 512 is the round number inside that band and is what every worst-case fixture below
// uses, so the fit/overlap tests exercise the panel this geometry actually has to live in, not an
// arbitrary round number.
const PANEL_SIZE = 512;

function body(overrides: Partial<BodyView> = {}): BodyView {
  return {
    id: "b1",
    bodyType: "temperate_world",
    archetypeName: "Temperate World",
    score: 1.0,
    locked: false,
    counts: emptyResourceVector(),
    quality: emptyResourceVector(),
    workedCounts: emptyResourceVector(),
    peopleLand: 480,
    occupied: false,
    orbitIndex: 1,
    size: 1,
    ...overrides,
  };
}

/** Eight bodies, orbitIndex 1..8, every one at the largest authored display size — the worst case
 *  for both fit (biggest drawn radius pushing outward) and overlap (biggest radii to clear). */
function worstCaseEight(): BodyView[] {
  return Array.from({ length: 8 }, (_, i) => body({
    id: `b${i + 1}`, orbitIndex: i + 1, size: DISPLAY_SIZE_MAX,
  }));
}

describe("ringLayout", () => {
  it("keeps adjacent rings from overlapping even at the largest drawn body size", () => {
    const layout = ringLayout(worstCaseEight(), PANEL_SIZE);
    for (let i = 1; i < 8; i++) {
      const a = layout.bodies[`b${i}`];
      const b = layout.bodies[`b${i + 1}`];
      const gap = b.ringRadius - a.ringRadius;
      expect(gap).toBeGreaterThanOrEqual(a.radius + b.radius);
    }
  });

  it("spreads successive bodies by the golden angle instead of bunching", () => {
    const bodies = Array.from({ length: 6 }, (_, i) => body({ id: `b${i + 1}`, orbitIndex: i + 1 }));
    const layout = ringLayout(bodies, PANEL_SIZE);
    for (let i = 1; i < 6; i++) {
      const a = layout.bodies[`b${i}`];
      const b = layout.bodies[`b${i + 1}`];
      const angleA = Math.atan2(a.cy - layout.cy, a.cx - layout.cx);
      const angleB = Math.atan2(b.cy - layout.cy, b.cx - layout.cx);
      let deltaDeg = ((angleB - angleA) * 180) / Math.PI;
      deltaDeg = ((deltaDeg % 360) + 360) % 360;
      expect(deltaDeg).toBeCloseTo(137.5, 5);
    }
  });

  it("resolves the same bodies and size to identical coordinates on every call", () => {
    const bodies = [body({ id: "b1", orbitIndex: 1 }), body({ id: "b2", orbitIndex: 2, size: 1.3 })];
    const first = ringLayout(bodies, PANEL_SIZE);
    const second = ringLayout(bodies, PANEL_SIZE);
    expect(second).toEqual(first);
  });

  it("scales a body's drawn radius with the panel's own dimension", () => {
    const bodies = [body({ id: "b1", orbitIndex: 1 })];
    const small = ringLayout(bodies, 200).bodies.b1.radius;
    const large = ringLayout(bodies, 800).bodies.b1.radius;
    expect(large).toBeGreaterThan(small);
  });

  it("draws a larger circle for a body with a larger authored size, at one fixed panel size", () => {
    // Two bodies differing ONLY in their own `size` field (spanning the full authored
    // DISPLAY_SIZE_MIN..MAX band) must resolve to different `radius` values, ordered the way the
    // band says: the DISPLAY_SIZE_MAX body draws larger than the DISPLAY_SIZE_MIN one. This is
    // distinct from the panel-size test above, which varies the panel's `size` parameter, not the
    // body's own field of the same name.
    const bodies = [
      body({ id: "smallest", orbitIndex: 1, size: DISPLAY_SIZE_MIN }),
      body({ id: "largest", orbitIndex: 2, size: DISPLAY_SIZE_MAX }),
    ];
    const layout = ringLayout(bodies, PANEL_SIZE);
    expect(layout.bodies.largest.radius).toBeGreaterThan(layout.bodies.smallest.radius);
  });

  it("yields finite, non-negative geometry for a degenerate panel size", () => {
    const bodies = [body({ id: "b1", orbitIndex: 1 })];
    for (const size of [0, -100, NaN]) {
      const layout = ringLayout(bodies, size);
      expect(Number.isFinite(layout.cx)).toBe(true);
      expect(Number.isFinite(layout.cy)).toBe(true);
      expect(Number.isFinite(layout.starRadius)).toBe(true);
      expect(layout.starRadius).toBeGreaterThanOrEqual(0);
      const b1 = layout.bodies.b1;
      expect(Number.isFinite(b1.ringRadius)).toBe(true);
      expect(Number.isFinite(b1.radius)).toBe(true);
      expect(b1.radius).toBeGreaterThanOrEqual(0);
    }
  });

  it("fits the eight-body, maximum-size worst case inside the panel without clipping", () => {
    const layout = ringLayout(worstCaseEight(), PANEL_SIZE);
    const budget = PANEL_SIZE / 2;
    for (const rb of Object.values(layout.bodies)) {
      expect(rb.ringRadius + rb.radius).toBeLessThanOrEqual(budget + 1e-9);
    }
  });

  it("orders ring radius by orbitIndex, ring 1 innermost", () => {
    const bodies = Array.from({ length: 8 }, (_, i) => body({ id: `b${i + 1}`, orbitIndex: i + 1 }));
    const layout = ringLayout(bodies, PANEL_SIZE);
    for (let i = 1; i < 8; i++) {
      expect(layout.bodies[`b${i + 1}`].ringRadius).toBeGreaterThan(layout.bodies[`b${i}`].ringRadius);
    }
  });

  describe("hitRadius — the uniform interactive-area target", () => {
    it("is never smaller than the body's own drawn circle, across the whole authored size band", () => {
      const bodies = [
        body({ id: "smallest", orbitIndex: 1, size: DISPLAY_SIZE_MIN }),
        body({ id: "middle", orbitIndex: 2, size: 1 }),
        body({ id: "largest", orbitIndex: 3, size: DISPLAY_SIZE_MAX }),
      ];
      const layout = ringLayout(bodies, PANEL_SIZE);
      for (const rb of Object.values(layout.bodies)) {
        expect(rb.hitRadius).toBeGreaterThanOrEqual(rb.radius);
      }
    });

    it("gives every body the same hit target regardless of its own authored size", () => {
      const bodies = [
        body({ id: "smallest", orbitIndex: 1, size: DISPLAY_SIZE_MIN }),
        body({ id: "middle", orbitIndex: 2, size: 1 }),
        body({ id: "largest", orbitIndex: 3, size: DISPLAY_SIZE_MAX }),
      ];
      const layout = ringLayout(bodies, PANEL_SIZE);
      const targets = Object.values(layout.bodies).map((rb) => rb.hitRadius);
      expect(new Set(targets).size).toBe(1);
    });

    it("never lets the hit target on the outermost ring push a body past the panel", () => {
      // Worst case for fit: eight bodies, all at maximum drawn size — the same fixture the
      // drawn-radius fit test above uses, since hitRadius is now uniformly the same bound.
      const layout = ringLayout(worstCaseEight(), PANEL_SIZE);
      const budget = PANEL_SIZE / 2;
      for (const rb of Object.values(layout.bodies)) {
        expect(rb.ringRadius + rb.hitRadius).toBeLessThanOrEqual(budget + 1e-9);
      }
    });

    it("never lets two adjacent hit targets overlap, even at the worst-case body count", () => {
      const layout = ringLayout(worstCaseEight(), PANEL_SIZE);
      for (let i = 1; i < 8; i++) {
        const a = layout.bodies[`b${i}`];
        const b = layout.bodies[`b${i + 1}`];
        const gap = b.ringRadius - a.ringRadius;
        expect(gap).toBeGreaterThanOrEqual(a.hitRadius + b.hitRadius);
      }
    });
  });
});
