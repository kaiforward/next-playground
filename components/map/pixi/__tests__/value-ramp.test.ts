import { describe, it, expect } from "vitest";
import {
  valueRampColorPixi, rampFloorPixi, rampTopPixi, ABSENT_COLOR, rampCssStops, ABSENT_CSS, deEmphasise,
  provisionLegendStops, lanesLegendStops,
} from "@/components/map/pixi/value-ramp";
import { SUPPLIED_PROVISION, RATIONING_PROVISION, DEPRIVED_PROVISION } from "@/lib/constants/economy";
import { LANE_BAND_COLOR } from "@/components/map/pixi/theme";

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
function sum(color: number): number {
  return channels(color).reduce((a, b) => a + b, 0);
}

describe("valueRampColorPixi", () => {
  it("returns black for exactly zero", () => {
    expect(valueRampColorPixi(0, 100, "development")).toBe(ABSENT_COLOR);
  });
  it("returns black for negative or NaN (never a coloured cell)", () => {
    expect(valueRampColorPixi(-5, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(Number.NaN, 100, "population")).toBe(ABSENT_COLOR);
  });
  it("a tiny present value reads the grey floor, NOT black", () => {
    const c = valueRampColorPixi(0.0001, 1, "development");
    expect(c).not.toBe(ABSENT_COLOR);
    expect(c).toBe(rampFloorPixi("development"));
  });
  it("the reference-max value reads the top of the ramp", () => {
    expect(valueRampColorPixi(50, 50, "population")).toBe(rampTopPixi("population"));
  });
  it("clamps values above the reference to the top", () => {
    expect(valueRampColorPixi(200, 50, "stability")).toBe(rampTopPixi("stability"));
  });
  it("guards a zero reference max (no divide-by-zero → clamps to top)", () => {
    expect(valueRampColorPixi(5, 0, "population")).toBe(rampTopPixi("population"));
  });
});

describe("population palette — two-pole red→green with black reserved for zero", () => {
  it("reads black at zero and the red floor for a tiny present value", () => {
    expect(valueRampColorPixi(0, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(0.0001, 1, "population")).toBe(rampFloorPixi("population"));
  });
  it("the reference-max value reads the green endpoint", () => {
    expect(valueRampColorPixi(50, 50, "population")).toBe(rampTopPixi("population"));
  });
  it("a near-zero present value reads the red endpoint", () => {
    expect(valueRampColorPixi(0.0001, 100, "population")).toBe(rampFloorPixi("population"));
  });
  it("has no amber midpoint — exactly 2 stops", () => {
    expect(rampCssStops("population")).toHaveLength(2);
  });
});

describe("stability — present-zero rides the red floor, not black", () => {
  it("colours a maximally-unstable present system red (absence is the caller's job)", () => {
    expect(valueRampColorPixi(0, 1, "stability")).toBe(rampFloorPixi("stability"));
    expect(valueRampColorPixi(0, 1, "stability")).not.toBe(ABSENT_COLOR);
  });
});

describe("migration — red→green, no reserved-zero (absence is developed gating)", () => {
  it("the reference-max value reads green, a tiny present value reads red", () => {
    expect(valueRampColorPixi(50, 50, "migration")).toBe(rampTopPixi("migration"));
    expect(valueRampColorPixi(0.0001, 50, "migration")).toBe(rampFloorPixi("migration"));
  });
  it("RESERVES_ABSENT_ZERO is false — a literal 0 rides the red floor, not black", () => {
    expect(valueRampColorPixi(0, 1, "migration")).toBe(rampFloorPixi("migration"));
    expect(valueRampColorPixi(0, 1, "migration")).not.toBe(ABSENT_COLOR);
  });
  it("a tiny present value is never ABSENT_COLOR — rides the red floor, unlike population's literal-0", () => {
    expect(valueRampColorPixi(0.0001, 1, "migration")).not.toBe(ABSENT_COLOR);
  });
  it("rampCssStops is a red→green two-stop legend", () => {
    const migrationStops = rampCssStops("migration");
    expect(migrationStops).toHaveLength(2);
    expect(migrationStops[0]).toMatch(/^rgb\(/);
  });
});

describe("rampCssStops / ABSENT_CSS — the legend's single source", () => {
  it("returns one rgb() stop per ramp anchor", () => {
    const stops = rampCssStops("development");
    expect(stops).toHaveLength(3);
    expect(stops[0]).toMatch(/^rgb\(/);
  });
  it("exposes the reserved absent colour as a hex string", () => {
    expect(ABSENT_CSS).toBe("#08090c");
  });
});

describe("provision — stepped fill at the band edges, not a continuous ramp", () => {
  it("two values well inside one band render the same colour", () => {
    // Supplied (>= 0.9) is the one band where stepped and continuous agree by construction: it sits
    // at/above the top stop, where sample() clamps. So this pair documents the property but cannot
    // discriminate — the two below are what actually fail if the stepping is lost.
    expect(valueRampColorPixi(0.92, 1, "provision")).toBe(valueRampColorPixi(0.99, 1, "provision"));
    // Far apart WITHIN the Strained band [0.7, 0.9).
    expect(valueRampColorPixi(0.72, 1, "provision")).toBe(valueRampColorPixi(0.88, 1, "provision"));
    // Far apart WITHIN the Rationing band [0.5, 0.7).
    expect(valueRampColorPixi(0.52, 1, "provision")).toBe(valueRampColorPixi(0.68, 1, "provision"));
    // Far apart WITHIN the Deprived band [0, 0.5).
    expect(valueRampColorPixi(0.02, 1, "provision")).toBe(valueRampColorPixi(0.45, 1, "provision"));
  });
  it("two values either side of a band edge render different colours", () => {
    expect(valueRampColorPixi(DEPRIVED_PROVISION - 0.01, 1, "provision"))
      .not.toBe(valueRampColorPixi(DEPRIVED_PROVISION + 0.01, 1, "provision"));
    expect(valueRampColorPixi(RATIONING_PROVISION - 0.01, 1, "provision"))
      .not.toBe(valueRampColorPixi(RATIONING_PROVISION + 0.01, 1, "provision"));
    expect(valueRampColorPixi(SUPPLIED_PROVISION - 0.01, 1, "provision"))
      .not.toBe(valueRampColorPixi(SUPPLIED_PROVISION + 0.01, 1, "provision"));
  });
  it("an edge value itself belongs to the higher band (inclusive low edge, matching the classifier)", () => {
    expect(valueRampColorPixi(DEPRIVED_PROVISION, 1, "provision")).toBe(valueRampColorPixi(0.68, 1, "provision"));
    expect(valueRampColorPixi(RATIONING_PROVISION, 1, "provision")).toBe(valueRampColorPixi(0.88, 1, "provision"));
    // Same caveat as above — the Supplied pair documents inclusivity but clamps under either path;
    // the two edge assertions on the lines above are the ones that fail if an edge moves.
    expect(valueRampColorPixi(SUPPLIED_PROVISION, 1, "provision")).toBe(valueRampColorPixi(0.99, 1, "provision"));
  });
  it("paints the Deprived band its own colour, distinct from every band above it", () => {
    // The point of the split: one 70%-wide bin painted a world at 65% and a world at 5% identically.
    // A ramp that dropped the fourth step would read the same colour at 0.05 as at 0.65.
    const deprived = valueRampColorPixi(0.05, 1, "provision");
    const rationing = valueRampColorPixi(0.65, 1, "provision");
    const strained = valueRampColorPixi(0.8, 1, "provision");
    const supplied = valueRampColorPixi(0.95, 1, "provision");
    expect(new Set([deprived, rationing, strained, supplied]).size).toBe(4);
  });
  it("a literal 0% Provisioned still rides the low band, never ABSENT_COLOR — absence is a missing field here, not a zero value", () => {
    expect(valueRampColorPixi(0, 1, "provision")).not.toBe(ABSENT_COLOR);
  });
  it("ignores referenceMax entirely — band edges are absolute percentages, never re-scaled to a scope max", () => {
    // 0.95 sits in the Supplied band raw. A referenceMax of 2 would normalise it to 0.475 — the
    // Rationing band, a DIFFERENT colour — if provision were re-scaling like the continuous modes.
    // Picking a referenceMax that actually crosses a band edge is the point: a referenceMax that
    // stays inside the same post-division band (e.g. 1 vs 1000 on a low value) would pass this
    // assertion even with re-scaling left in, by coincidence.
    const atSmallScope = valueRampColorPixi(0.95, 1, "provision");
    const atLargeScope = valueRampColorPixi(0.95, 2, "provision");
    expect(atSmallScope).toBe(atLargeScope);
    // Contrast: a continuous mode's colour DOES move the same way — this is the exemption
    // provision is being pinned against, not a universal property of valueRampColorPixi.
    expect(valueRampColorPixi(0.95, 1, "population")).not.toBe(valueRampColorPixi(0.95, 2, "population"));
  });
});

describe("provisionLegendStops — stepped legend carries stop POSITIONS, not evenly spaced", () => {
  it("positions sit at the real band edges (0, DEPRIVED_, RATIONING_, SUPPLIED_PROVISION), not even quarters", () => {
    const stops = provisionLegendStops();
    expect(stops.map((s) => s.position))
      .toEqual([0, DEPRIVED_PROVISION, RATIONING_PROVISION, SUPPLIED_PROVISION]);
    // The failure a position-discarding helper would produce: even spacing at 0, 1/4, 1/2, 3/4.
    expect(stops.map((s) => s.position)).not.toEqual([0, 0.25, 0.5, 0.75]);
  });
  it("returns one rgb() css colour per band, low to high, and no two bands share one", () => {
    const stops = provisionLegendStops();
    expect(stops).toHaveLength(4);
    for (const s of stops) expect(s.css).toMatch(/^rgb\(/);
    // The legend must show as many states as the fill paints — a duplicated swatch would read as
    // three bands on a four-band choropleth.
    expect(new Set(stops.map((s) => s.css)).size).toBe(4);
  });
  it("every legend swatch is the colour the fill paints inside that band — the legend cannot drift from the cells", () => {
    // provisionLegendStops and valueRampColorPixi read the same PROVISION_BANDS table today; this is
    // what fails if either grows its own copy. Sampled strictly inside each band, not on the edges.
    const insideEachBand = [0.05, 0.6, 0.8, 0.95];
    const stops = provisionLegendStops();
    for (const [i, value] of insideEachBand.entries()) {
      const [r, g, b] = [16, 8, 0].map((shift) => (valueRampColorPixi(value, 1, "provision") >> shift) & 0xff);
      expect(stops[i].css, `band ${i} @ ${value}`).toBe(`rgb(${r}, ${g}, ${b})`);
    }
  });
});

describe("valueRampColorPixi — lanes mode, stepped on the band index", () => {
  it("returns exactly three distinct colours for the three band indexes", () => {
    const fine = valueRampColorPixi(0, 1, "lanes");
    const busy = valueRampColorPixi(1, 1, "lanes");
    const congested = valueRampColorPixi(2, 1, "lanes");
    expect(new Set([fine, busy, congested]).size).toBe(3);
    expect(fine).toBe(LANE_BAND_COLOR.fine);
    expect(busy).toBe(LANE_BAND_COLOR.busy);
    expect(congested).toBe(LANE_BAND_COLOR.congested);
  });
  it("the same colour reads for any value within a band — 0.4 reads fine, 1.6 reads busy", () => {
    expect(valueRampColorPixi(0.4, 1, "lanes")).toBe(LANE_BAND_COLOR.fine);
    expect(valueRampColorPixi(1.6, 1, "lanes")).toBe(LANE_BAND_COLOR.busy);
  });
  it("ignores referenceMax entirely — the index is the value, never divided by a scope max", () => {
    expect(valueRampColorPixi(1.2, 1, "lanes")).toBe(valueRampColorPixi(1.2, 1000, "lanes"));
  });
  it("clamps a value above the top band to congested, and below zero to fine", () => {
    expect(valueRampColorPixi(9, 1, "lanes")).toBe(LANE_BAND_COLOR.congested);
    expect(valueRampColorPixi(-3, 1, "lanes")).toBe(LANE_BAND_COLOR.fine);
  });
});

describe("lanesLegendStops — stepped legend for the Lanes mode", () => {
  it("returns one stop per band, in fine/busy/congested order, matching the fill colours", () => {
    const stops = lanesLegendStops();
    expect(stops.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(stops[0].css).not.toBe(stops[1].css);
    expect(stops[1].css).not.toBe(stops[2].css);
  });
});

describe("deEmphasise — out-of-scope de-emphasis treatments", () => {
  it("'both' greys and darkens: never ABSENT_COLOR, summed channels strictly lower", () => {
    const input = rampTopPixi("population");
    const out = deEmphasise(input, "both");
    expect(out).not.toBe(ABSENT_COLOR);
    expect(sum(out)).toBeLessThan(sum(input));
  });
  it("'dim' darkens without erasing colour: summed channels strictly lower", () => {
    const input = rampTopPixi("stability");
    const out = deEmphasise(input, "dim");
    expect(out).not.toBe(ABSENT_COLOR);
    expect(sum(out)).toBeLessThan(sum(input));
  });
  it("'desat' pulls channels toward each other (less saturated)", () => {
    const input = rampTopPixi("population"); // a saturated green, channels far apart
    const out = deEmphasise(input, "desat");
    const [r, g, b] = channels(out);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const [ir, ig, ib] = channels(input);
    const inputSpread = Math.max(ir, ig, ib) - Math.min(ir, ig, ib);
    expect(spread).toBeLessThan(inputSpread);
  });
  it("is idempotent-safe on an already-dark development floor colour (still not ABSENT_COLOR)", () => {
    const out = deEmphasise(rampFloorPixi("development"), "both");
    expect(out).not.toBe(ABSENT_COLOR);
  });
});
