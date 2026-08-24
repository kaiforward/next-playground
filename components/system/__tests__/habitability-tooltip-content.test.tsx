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
      { className: "Jungle World", score: 0.7, occupied: true, frontier: true, partial: true },
    ];
    const { container } = render(<HabitabilityTooltipContent growthMultiplier={0.85} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 85%");
    expect(container.textContent).toContain("Population growth: −15%");
  });

  it("a neutral growthMultiplier (1.0 — the ceiling, never a midpoint) reads 0%, never a signed value", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, occupied: true, frontier: true, partial: false },
    ];
    const { container } = render(<HabitabilityTooltipContent growthMultiplier={1} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 100%");
    expect(container.textContent).toContain("Population growth: 0%");
    expect(container.textContent).not.toContain("+");
  });

  it("the penalty-only scale never renders a plus sign, whatever the modifier's magnitude", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, occupied: true, frontier: true, partial: false },
    ];
    const { container } = render(<HabitabilityTooltipContent growthMultiplier={0.5} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Population growth: −50%");
    expect(container.textContent).not.toContain("+");
  });

  it("lists every body in the order it was handed, as a percentage, marking only the genuinely partial (mid-fill) body", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, occupied: true, frontier: false, partial: false },
      { className: "Ocean World", score: 0.65, occupied: true, frontier: true, partial: true },
      { className: "Boreal World", score: 0.6, occupied: false, frontier: false, partial: false },
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

    // Only the genuinely partial body carries the marker — a list that unmarks it, or marks a
    // second body, fails this. No internal vocabulary ("frontier") reaches the player.
    expect(items[0]).not.toHaveTextContent("Partial");
    expect(items[1]).toHaveTextContent("Partial");
    expect(items[2]).not.toHaveTextContent("Partial");
    expect(screen.queryByText(/Frontier/)).not.toBeInTheDocument();
  });

  it("marks the frontier body's clamp arm (all bodies full) and zero-occupancy arm as NOT Partial", () => {
    // frontier true but partial false: the saturated-system-last-body and zero-pop-first-body
    // arms both name a marginal body without either being mid-fill.
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, occupied: true, frontier: true, partial: false },
    ];
    render(<HabitabilityTooltipContent growthMultiplier={1} fillOrder={fillOrder} />);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent("Partial");
  });

  it("a dropped body is visible as a shorter list, not silently absorbed", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, occupied: true, frontier: true, partial: true },
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
