import { describe, it, expect } from "vitest";
import { stabilityView } from "@/components/system/stability-view";
import type { SystemUnrestRead } from "@/lib/types/api";

// Pure view-model — no render, no DOM. This is the single place unrest becomes stability, so this
// is the file that has to be right about direction.

/**
 * The reproduction, from the real reading: seed 42, 600 systems, 1000 ticks, `system-481` —
 * Provision 0.0000, band famine, population 2.0, unrest 0.150. A famine world at Provision 0 reads
 * `supplyUnrestTerm = slopeShortage × d = 2.4 × 1`, a `low` tax level adds 0.02, and 2.0 residents
 * under capacity add no crowding — so the causes settle at min(1, 2.42) = 1, total collapse, while
 * the accumulator has only crawled to 0.150. Current and settled are as far apart as this panel can
 * put them, which is the entire point: a fixture where they nearly agree proves nothing.
 */
const dyingWorld: SystemUnrestRead = {
  assessed: true,
  contributors: { goods: 2.4, tax: 0.02, crowding: 0 },
  settled: 1,
  trend: "rising",
  strikeThreshold: 0.65,
};

describe("stabilityView — the one conversion from unrest to stability", () => {
  it("the dying world reads as heading for collapse: an 85% headline whose outlook is 0%, falling, below the 35% strike line", () => {
    const view = stabilityView({ unrest: 0.15, striking: false, read: dyingWorld });

    expect(view.pct).toBe(85); // 1 - 0.150, the live accumulator
    expect(view.outlook).toEqual({ known: true, pct: 0, direction: "falling" });
    expect(view.strikePct).toBe(35); // 1 - 0.65
    // The divergence is the finding — a panel that averaged these into one number would be the bug.
    expect(view.outlook.known && view.outlook.pct).toBeLessThan(view.strikePct);
    expect(view.pct).toBeGreaterThan(view.strikePct);
  });

  it("`rising` unrest is stability FALLING and `recovering` unrest is stability CLIMBING — the inversion the read's own words get backwards", () => {
    const rising = stabilityView({
      unrest: 0.28,
      striking: false,
      read: { assessed: true, contributors: { goods: 0.8, tax: 0.1, crowding: 0.01 }, settled: 0.91, trend: "rising", strikeThreshold: 0.65 },
    });
    const recovering = stabilityView({
      unrest: 0.91,
      striking: false,
      read: { assessed: true, contributors: { goods: 0.2, tax: 0.08, crowding: 0 }, settled: 0.28, trend: "recovering", strikeThreshold: 0.65 },
    });
    const steady = stabilityView({
      unrest: 0.28,
      striking: false,
      read: { assessed: true, contributors: { goods: 0.2, tax: 0.08, crowding: 0 }, settled: 0.28, trend: "stable", strikeThreshold: 0.65 },
    });

    expect(rising.outlook).toEqual({ known: true, pct: 9, direction: "falling" });
    expect(recovering.outlook).toEqual({ known: true, pct: 72, direction: "climbing" });
    expect(steady.outlook).toEqual({ known: true, pct: 72, direction: "holding" });
    // A world whose stability is falling must never be described with the read's own "rising".
    expect(rising.outlook.known && rising.outlook.direction).not.toBe("climbing");
  });

  it("the outlook always sits on the same side of the headline as the direction word claims", () => {
    const view = stabilityView({ unrest: 0.15, striking: false, read: dyingWorld });
    expect(view.outlook.known && view.outlook.direction).toBe("falling");
    expect(view.outlook.known && view.outlook.pct).toBeLessThan(view.pct);
  });

  it("the headline is the live accumulator, never the settled value the causes decompose", () => {
    const view = stabilityView({ unrest: 0.15, striking: false, read: dyingWorld });
    expect(view.pct).toBe(85);
    expect(view.pct).not.toBe(0); // 1 - settled
    expect(view.pct).not.toBe(15); // raw unrest, un-inverted
  });

  it("causes keep the raw contributor scale, uninverted and in cause order — a 2.4 goods term stays 2.4", () => {
    const view = stabilityView({ unrest: 0.15, striking: false, read: dyingWorld });
    expect(view.causes.map((c) => c.label)).toEqual(["Goods shortfall", "Tax pressure", "Crowding"]);
    expect(view.causes.map((c) => c.value)).toEqual([2.4, 0.02, 0]);
    expect(view.causesIncomplete).toBe(false);
  });

  it("unassessed: the outlook is withheld rather than guessed, the causes are flagged incomplete, and the missing goods bar cannot make the headline calmer", () => {
    const unassessed: SystemUnrestRead = {
      assessed: false,
      contributors: { tax: 0.02, crowding: 0 },
      strikeThreshold: 0.65,
    };
    const view = stabilityView({ unrest: 0.15, striking: false, read: unassessed });

    expect(view.outlook).toEqual({ known: false });
    expect(view.causesIncomplete).toBe(true);
    expect(view.causes.map((c) => c.label)).toEqual(["Tax pressure", "Crowding"]);
    // Same unrest as the dying world: the headline is identical, because it reads the accumulator
    // and never the visible causes' sum. Withholding goods withholds the OUTLOOK, not the reading.
    expect(view.pct).toBe(stabilityView({ unrest: 0.15, striking: false, read: dyingWorld }).pct);
    expect(view.strikePct).toBe(35);
  });

  it("out-of-range inputs clamp into the track rather than escaping it", () => {
    const over = stabilityView({
      unrest: 1.4,
      striking: true,
      read: { assessed: true, contributors: { goods: 3, tax: 0.18, crowding: 0.05 }, settled: 1.2, trend: "rising", strikeThreshold: 0.65 },
    });
    expect(over.pct).toBe(0);
    expect(over.outlook).toEqual({ known: true, pct: 0, direction: "falling" });
    expect(over.striking).toBe(true);
  });
});
