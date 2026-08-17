import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FundingSlider } from "@/components/form/funding-slider";

/**
 * The band's insolvency tag. `set` is live player policy (the thumb) and `runs` is the latched
 * outcome of the last settlement (the fill), so the gap between them is NOT the signal: dragging the
 * slider opens that gap immediately on a faction that paid every bill in full. Only the settlement
 * knows, so `shorted` arrives as a prop and these pin that the component obeys it rather than
 * re-deriving it.
 */
function renderSlider(props: Partial<React.ComponentProps<typeof FundingSlider>> = {}) {
  return render(
    <FundingSlider
      label="Construction"
      set={1}
      runs={0.5}
      shorted={false}
      interactive
      onCommit={vi.fn()}
      {...props}
    />,
  );
}

describe("FundingSlider — the shorted tag", () => {
  it("does not tag a solvent band whose slider the player has since raised above the latched fill", () => {
    // The exact state a player produces by dragging Construction from 50% to 100%: the fill still
    // shows the 50% the last settlement ran at, because no settlement has happened since. Nothing
    // was underpaid, so nothing is shorted — and the readout must not claim otherwise for taking the
    // very action a shortfall would ask for.
    renderSlider({ set: 1, runs: 0.5, shorted: false });

    expect(screen.getByText(/runs 50%/)).toBeInTheDocument();
    expect(screen.queryByText(/shorted/)).not.toBeInTheDocument();
  });

  it("tags a band the settlement genuinely could not pay", () => {
    renderSlider({ set: 1, runs: 0.5, shorted: true });

    expect(screen.getByText(/runs 50%/)).toBeInTheDocument();
    expect(screen.getByText(/shorted/)).toBeInTheDocument();
  });

  it("tags a band shorted under a LOWERED slider, which the fill alone cannot distinguish", () => {
    // The mirror failure. The player has dropped the slider to 50% while the last settlement ran at
    // 60% of the bill and still fell short of what it was asked. `runs` sits ABOVE `set` here, so
    // anything reading the gap would call this solvent — the shortfall is real and must show.
    renderSlider({ set: 0.5, runs: 0.6, shorted: true });

    expect(screen.getByText(/shorted/)).toBeInTheDocument();
  });

  it("still renders the band's label and its slider control in every case", () => {
    renderSlider({ label: "Logistics", shorted: true });

    expect(screen.getByText("Logistics")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Logistics funding" })).toBeInTheDocument();
  });
});
