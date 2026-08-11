import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StabilityBlock } from "@/components/system/population-panel";
import type { SystemUnrestRead } from "@/lib/types/api";

// No jsdom — react-dom/server render, asserting on real markup.

/** How many rules the track carries. `TrackRule` is the only absolutely-positioned element the
 *  block renders, so this counts heading-to + strike without depending on how either is painted —
 *  a negative assertion tied to one rule's colour or dash would pass vacuously the moment that
 *  painting changed. */
function ruleCount(html: string): number {
  return (html.match(/class="absolute /g) ?? []).length;
}

describe("StabilityBlock — two moments on one track: stability now, and where it is heading", () => {
  it("the dying world renders as visibly heading for collapse — an 85% fill, a heading-to rule at 0%, and the word Falling, never the read's own 'rising'", () => {
    // The reproduction: seed 42, 600 systems, 1000 ticks, `system-481` — Provision 0, famine,
    // population 2.0, unrest 0.150. Goods 2.4 is slopeShortage × d at Provision 0; settled is the
    // capped 1. The whole defect lives in the gap between 0.150 and 1.
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 2.4, tax: 0.02, crowding: 0 },
      settled: 1,
      trend: "rising",
      strikeThreshold: 0.65,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.15, striking: false, unrestBreakdown }),
    );

    expect(html).toContain('text-2xl text-text-primary">85%<'); // stability now
    expect(html).toContain("width:85%"); // the fill agrees with the headline
    expect(html).toContain("left:0%"); // the heading-to rule — total collapse
    expect(html).toContain("left:35%"); // the strike line, 1 - 0.65
    expect(ruleCount(html)).toBe(2); // both rules, on opposite overhangs so they never merge
    expect(html).toContain("Heading for 0%");
    expect(html).toContain("Now 85%");
    expect(html).toContain("Strike below 35%");
    expect(html).toContain("Falling");
    // `trend` describes UNREST. Printed as-is it would tell the owner a collapsing world is rising.
    expect(html).not.toContain("Rising");
    expect(html).not.toContain("Climbing");
  });

  it("no per-bar strike marker — the causes sum, so the strike line governs the total alone", () => {
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
    expect(html).toContain("Strike below 28%"); // 1 - 0.72
    // A tick across each bar would claim a per-cause threshold. `settled` here is 0.42 from three
    // causes none of which exceeds 0.3, and a system with 0.3/0.2/0.2 strikes with every bar under
    // the line — so the marker belongs to the total, which the track carries.
    expect(html).not.toContain("bg-text-primary/60"); // ContributorBars' own per-bar marker
    expect(html).toContain("Goods shortfall");
    expect(html).toContain("Holding");
  });

  it("unassessed: no heading-to rule and no direction word, an explicit incomplete-causes caveat, and only tax/crowding bars", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: false,
      contributors: { tax: 0.1, crowding: 0.02 },
      strikeThreshold: 0.58,
    };
    const html = renderToStaticMarkup(
      StabilityBlock({ unrest: 0.12, striking: false, unrestBreakdown }),
    );
    expect(html).toContain('text-2xl text-text-primary">88%<'); // the headline still reads live unrest
    expect(html).toContain("Strike below 42%"); // 1 - 0.58
    expect(html).toContain("Heading for — not yet assessed");
    expect(html).toContain("Goods shortfall is not assessed yet");
    // The withheld cause must not read as "no goods problem" by silent absence…
    expect(html).not.toContain(">Goods shortfall<");
    // …and no heading-to rule may be drawn from tax and crowding alone: the strike line is the
    // only rule on this track.
    expect(ruleCount(html)).toBe(1);
    expect(html).not.toContain("border-color:var(--color-text-secondary)");
    expect(html).not.toContain("Falling");
    expect(html).not.toContain("Holding");
    expect(html).not.toContain("Climbing");
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
    // Unrest recovering is stability climbing — the outlook sits ABOVE the headline.
    expect(html).toContain("Climbing");
    expect(html).toContain("Heading for 58%");
  });

  it("striking renders the production-suppressed warning alongside the same stability-scale key", () => {
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
    expect(html).toContain("Strike below 35%"); // 1 - 0.65
    expect(html).toContain("Production suppressed");
  });
});
