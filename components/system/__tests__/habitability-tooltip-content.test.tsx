import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HabitabilityTooltipContent } from "@/components/system/habitability-tooltip-content";
import type { FillOrderRow } from "@/lib/utils/substrate";

// Rendered directly (not via a hovered Tooltip trigger — Radix never mounts its portal content
// without an open interaction jsdom can't reliably drive) so the list itself is asserted against
// accessible text, exactly what a reader of the real tooltip sees.

describe("HabitabilityTooltipContent — every people-land body in score order, frontier marked", () => {
  it("lists every body in the order it was handed, marking only the frontier body", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: false },
      { className: "Ocean World", score: 0.65, peopleLand: 150, occupied: true, frontier: true },
      { className: "Boreal World", score: 0.6, peopleLand: 100, occupied: false, frontier: false },
    ];
    render(<HabitabilityTooltipContent fillOrder={fillOrder} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Jungle World");
    expect(items[1]).toHaveTextContent("Ocean World");
    expect(items[2]).toHaveTextContent("Boreal World");

    // Only the marginal body carries the Frontier marker — a list that unmarks it, or marks a
    // second body, fails this.
    expect(items[0]).not.toHaveTextContent("Frontier");
    expect(items[1]).toHaveTextContent("Frontier");
    expect(items[2]).not.toHaveTextContent("Frontier");
  });

  it("a dropped body is visible as a shorter list, not silently absorbed", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: true },
    ];
    render(<HabitabilityTooltipContent fillOrder={fillOrder} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("an empty fill order (no people-land body) renders a stated absence, never a blank list", () => {
    render(<HabitabilityTooltipContent fillOrder={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/No people-land bodies/)).toBeInTheDocument();
  });
});
