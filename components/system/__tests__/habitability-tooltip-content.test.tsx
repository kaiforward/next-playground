import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HabitabilityTooltipContent } from "@/components/system/habitability-tooltip-content";
import type { FillOrderRow } from "@/lib/utils/substrate";

// Rendered directly (not via a hovered Tooltip trigger — Radix never mounts its portal content
// without an open interaction jsdom can't reliably drive) so the list itself is asserted against
// accessible text, exactly what a reader of the real tooltip sees.

describe("HabitabilityTooltipContent — headline stat, growth modifier, every habitable-land body in score order, marginal body marked", () => {
  it("renders the headline habitability stat and its population-growth modifier from growthMultiplier alone", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: true },
    ];
    const { container } = render(<HabitabilityTooltipContent growthMultiplier={0.85} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 85%");
    expect(container.textContent).toContain("Population growth: −15%");
  });

  it("a growthMultiplier above 1 reads a signed positive modifier", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, peopleLand: 500, occupied: true, frontier: true },
    ];
    const { container } = render(<HabitabilityTooltipContent growthMultiplier={1.1} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 110%");
    expect(container.textContent).toContain("Population growth: +10%");
  });

  it("lists every body in the order it was handed, as a percentage, marking only the marginal body", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: false },
      { className: "Ocean World", score: 0.65, peopleLand: 150, occupied: true, frontier: true },
      { className: "Boreal World", score: 0.6, peopleLand: 100, occupied: false, frontier: false },
    ];
    render(<HabitabilityTooltipContent growthMultiplier={0.93} fillOrder={fillOrder} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Jungle World");
    expect(items[0]).toHaveTextContent("70%");
    expect(items[1]).toHaveTextContent("Ocean World");
    expect(items[1]).toHaveTextContent("65%");
    expect(items[2]).toHaveTextContent("Boreal World");
    expect(items[2]).toHaveTextContent("60%");

    // Only the marginal body carries the marker — a list that unmarks it, or marks a second body,
    // fails this. No internal vocabulary ("frontier") reaches the player.
    expect(items[0]).not.toHaveTextContent("Partial");
    expect(items[1]).toHaveTextContent("Partial");
    expect(items[2]).not.toHaveTextContent("Partial");
    expect(screen.queryByText(/Frontier/)).not.toBeInTheDocument();
  });

  it("a dropped body is visible as a shorter list, not silently absorbed", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: true },
    ];
    render(<HabitabilityTooltipContent growthMultiplier={0.7} fillOrder={fillOrder} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("an empty fill order (no habitable-land body) renders a stated absence, never a blank list", () => {
    render(<HabitabilityTooltipContent growthMultiplier={1} fillOrder={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/No habitable-land bodies/)).toBeInTheDocument();
    expect(screen.queryByText(/people-land/)).not.toBeInTheDocument();
  });
});
