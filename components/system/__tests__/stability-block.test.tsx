import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StabilityBlock } from "@/components/system/population-panel";
import type { SystemUnrestRead } from "@/lib/types/api";

// Every number the block prints is computed in `stabilityView` and asserted against numbers in
// `stability-view.test.ts`. What is left for the DOM is what a reader is actually told — the
// headline, the direction word, the three key lines, the caveats — and which marks are on the
// track at all.

/**
 * Every absolutely-positioned mark in the block. `TrackRule` is the only thing that renders one —
 * `ContributorBars` has no per-bar marker of its own — so this count says how many rules the track
 * carries, without depending on how any one of them is painted. A negative assertion tied to one
 * rule's colour or dash would pass vacuously the moment that painting changed.
 */
function marks(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll(".absolute");
}

describe("StabilityBlock — two moments on one track: stability now, and where it is heading", () => {
  it("the dying world renders as visibly heading for collapse — an 85% headline, a heading-to rule at total collapse, and the word Falling, never the read's own 'rising'", () => {
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
    const { container } = render(
      <StabilityBlock unrest={0.15} striking={false} unrestBreakdown={unrestBreakdown} />,
    );

    expect(screen.getByText("85%")).toBeInTheDocument(); // stability now
    expect(screen.getByText("Now 85%")).toBeInTheDocument();
    expect(screen.getByText("Heading for 0%")).toBeInTheDocument();
    expect(screen.getByText("Strike below 35%")).toBeInTheDocument();
    expect(marks(container)).toHaveLength(2); // both track rules
    expect(screen.getByText(/Falling/)).toBeInTheDocument();
    // `trend` describes UNREST. Printed as-is it would tell the owner a collapsing world is rising.
    expect(screen.queryByText(/rising/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Climbing/)).not.toBeInTheDocument();
  });

  it("no per-bar strike marker — the causes sum, so the strike line governs the total alone", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 0.3, tax: 0.1, crowding: 0.02 },
      settled: 0.42,
      trend: "stable",
      strikeThreshold: 0.72, // deliberately NOT STRIKE_PARAMS.threshold (0.65), to prove no hardcoding
    };
    const { container } = render(
      <StabilityBlock unrest={0.4} striking={false} unrestBreakdown={unrestBreakdown} />,
    );
    expect(screen.getByText("Strike below 28%")).toBeInTheDocument(); // 1 - 0.72
    // `ContributorBars` has no per-bar marker to draw, so the absence here is structural, not
    // merely unasserted. The design reasoning still holds: a tick across each bar would have
    // claimed a per-cause threshold, but `settled` here is 0.42 from three causes none of which
    // exceeds 0.3, and a system with 0.3/0.2/0.2 strikes with every bar under the line — so the
    // marker belongs to the total, which the track carries. The count below is purely the track's
    // own rules.
    expect(marks(container)).toHaveLength(2);
    expect(screen.getByText("Goods shortfall")).toBeInTheDocument();
    expect(screen.getByText(/Holding/)).toBeInTheDocument();
  });

  it("unassessed: no heading-to rule and no direction word, an explicit incomplete-causes caveat, and only tax/crowding bars", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: false,
      contributors: { tax: 0.1, crowding: 0.02 },
      strikeThreshold: 0.58,
    };
    const { container } = render(
      <StabilityBlock unrest={0.12} striking={false} unrestBreakdown={unrestBreakdown} />,
    );
    expect(screen.getByText("88%")).toBeInTheDocument(); // the headline still reads live unrest
    expect(screen.getByText("Strike below 42%")).toBeInTheDocument(); // 1 - 0.58
    expect(screen.getByText("Heading for — not yet assessed")).toBeInTheDocument();
    expect(screen.getByText(/Goods shortfall is not assessed yet/)).toBeInTheDocument();
    // The withheld cause must not read as "no goods problem" by silent absence…
    expect(screen.queryByText("Goods shortfall")).not.toBeInTheDocument();
    // …and no heading-to rule may be drawn from tax and crowding alone: the strike line is the
    // only rule on this track.
    expect(marks(container)).toHaveLength(1);
    expect(screen.queryByText(/Falling/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Holding/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Climbing/)).not.toBeInTheDocument();
    expect(screen.getByText("Tax pressure")).toBeInTheDocument();
    expect(screen.getByText("Crowding")).toBeInTheDocument();
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
    render(<StabilityBlock unrest={0.63} striking={false} unrestBreakdown={unrestBreakdown} />);
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.queryByText("63%")).not.toBeInTheDocument();
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
    // Unrest recovering is stability climbing — the outlook sits ABOVE the headline.
    expect(screen.getByText(/Climbing/)).toBeInTheDocument();
    expect(screen.getByText("Heading for 58%")).toBeInTheDocument();
  });

  it("striking renders the production-suppressed warning alongside the same stability-scale key", () => {
    const unrestBreakdown: SystemUnrestRead = {
      assessed: true,
      contributors: { goods: 0.5, tax: 0.1, crowding: 0.05 },
      settled: 0.65,
      trend: "rising",
      strikeThreshold: 0.65,
    };
    render(<StabilityBlock unrest={0.7} striking={true} unrestBreakdown={unrestBreakdown} />);
    expect(screen.getByText("Strike below 35%")).toBeInTheDocument(); // 1 - 0.65
    expect(screen.getByText(/Production suppressed/)).toBeInTheDocument();
  });
});
