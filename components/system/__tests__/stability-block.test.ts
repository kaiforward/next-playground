import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StabilityBlock } from "@/components/system/population-panel";
import type { SystemUnrestRead } from "@/lib/types/api";

// No jsdom — react-dom/server render, asserting on real markup.

describe("StabilityBlock — the strike caption always names the read's own strikeThreshold, re-expressed on the stability scale", () => {
  it("assessed: caption reads `1 - strikeThreshold` as stability, and NO per-bar marker is drawn — the causes sum, so the strike line governs the total alone", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 0.3, tax: 0.1, crowding: 0.02 },
      settled: 0.42,
      trend: "stable",
      strikeThreshold: 0.72, // deliberately NOT STRIKE_PARAMS.threshold (0.65), to prove no hardcoding
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.4, striking: false, unrestBreakdown }),
    );
    expect(html).toContain("Strike below 28% stability."); // 1 - 0.72
    // A tick across each bar would claim a per-cause threshold. `settled` here is 0.42 from three
    // causes none of which exceeds 0.3, and a system with 0.3/0.2/0.2 strikes with every bar under
    // the line — so the marker belongs to the total, which the caption carries.
    expect(html).not.toContain("left:");
    expect(html).toContain("Goods shortfall");
  });

  it("unassessed: caption still reads the carried strikeThreshold re-expressed as stability, and only tax/crowding bars render (no goods)", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: false,
      contributors: { tax: 0.1, crowding: 0.02 },
      strikeThreshold: 0.58,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.12, striking: false, unrestBreakdown }),
    );
    expect(html).toContain("Strike below 42% stability."); // 1 - 0.58
    expect(html).not.toContain("Goods shortfall");
    expect(html).toContain("Tax pressure");
    expect(html).toContain("Crowding");
  });

  it("the headline is stability — `1 - unrest`, off the badge's own source value — never raw `unrest`, never `settled` (the contributors' capped sum)", () => {
    // All three candidate numbers are deliberately distinct: 1-unrest 37%, raw unrest 63%, and
    // settled (0.3+0.1+0.02) 42%. A wrong-direction implementation (printing raw unrest) or one
    // that reaches for `settled` instead of inverting `unrest` is caught.
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 0.3, tax: 0.1, crowding: 0.02 },
      settled: 0.42,
      trend: "recovering",
      strikeThreshold: 0.65,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.63, striking: false, unrestBreakdown }),
    );
    expect(html).toContain('text-2xl text-text-primary">37%<');
    expect(html).not.toContain('text-2xl text-text-primary">63%<');
    expect(html).not.toContain('text-2xl text-text-primary">42%<');
  });

  it("striking renders the production-suppressed warning alongside the same stability-scale caption", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 0.5, tax: 0.1, crowding: 0.05 },
      settled: 0.65,
      trend: "rising",
      strikeThreshold: 0.65,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.7, striking: true, unrestBreakdown }),
    );
    expect(html).toContain("Strike below 35% stability."); // 1 - 0.65
    expect(html).toContain("Production suppressed");
  });
});
