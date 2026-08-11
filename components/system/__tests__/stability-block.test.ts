import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StabilityBlock } from "@/components/system/population-panel";
import type { SystemUnrestRead } from "@/lib/types/api";

// No jsdom — react-dom/server render, asserting on real markup.

describe("StabilityBlock — the strike caption always names the read's own strikeThreshold", () => {
  it("assessed: caption reads the read's strikeThreshold, and the ContributorBars marker sits at that same scaled position — never a re-imported constant", () => {
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
    expect(html).toContain("Strike at 72%.");
    expect(html).toContain("left:72%"); // ContributorBars' threshold marker, same value
    expect(html).toContain("Goods shortfall");
  });

  it("unassessed: caption still reads the carried strikeThreshold, and only tax/crowding bars render (no goods)", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: false,
      contributors: { tax: 0.1, crowding: 0.02 },
      strikeThreshold: 0.58,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.12, striking: false, unrestBreakdown }),
    );
    expect(html).toContain("Strike at 58%.");
    expect(html).not.toContain("Goods shortfall");
    expect(html).toContain("Tax pressure");
    expect(html).toContain("Crowding");
  });

  it("striking renders the production-suppressed warning alongside the same caption", () => {
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
    expect(html).toContain("Strike at 65%.");
    expect(html).toContain("Production suppressed");
  });
});
