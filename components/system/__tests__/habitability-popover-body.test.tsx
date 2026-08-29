import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HabitabilityPopoverBody } from "@/components/system/habitability-popover-body";
import type { FillOrderRow } from "@/lib/utils/substrate";

// Rendered directly (not via a hovered Tooltip trigger — Radix never mounts its portal content
// without an open interaction jsdom can't reliably drive) so the list itself is asserted against
// accessible text, exactly what a reader of the real tooltip sees.

describe("HabitabilityPopoverBody — headline stat, every habitable-land body in score order, marginal body marked", () => {
  it("renders the headline habitability stat from growthMultiplier alone", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, occupied: true, frontier: true, partial: true },
    ];
    const { container } = render(<HabitabilityPopoverBody growthMultiplier={0.85} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 85%");
  });

  it("a neutral growthMultiplier (1.0 — the ceiling, never a midpoint) reads 100%, never 0%", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, occupied: true, frontier: true, partial: false },
    ];
    const { container } = render(<HabitabilityPopoverBody growthMultiplier={1} fillOrder={fillOrder} />);
    // The unpenalised case is the one a wrong scale reads backwards: a perfectly habitable system
    // is at FULL growth, and anything phrased as a modifier renders it "0%", which reads as no
    // growth at all.
    expect(container.textContent).toContain("Habitability: 100%");
    expect(container.textContent).not.toContain("Habitability: 0%");
    expect(container.textContent).not.toContain("Population growth");
  });

  it("states the multiplier once, as habitability — never also as a separate growth modifier", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Gaia World", score: 1.0, occupied: true, frontier: true, partial: false },
    ];
    const { container } = render(<HabitabilityPopoverBody growthMultiplier={0.5} fillOrder={fillOrder} />);
    expect(container.textContent).toContain("Habitability: 50%");
    // The same number written twice — once as 50%, once as "−50%" — is what this guards against.
    expect(container.textContent).not.toContain("Population growth");
    expect(container.textContent).not.toContain("−50%");
  });

  it("lists every body in the order it was handed, as a percentage, marking only the genuinely partial (mid-fill) body", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, occupied: true, frontier: false, partial: false },
      { className: "Ocean World", score: 0.65, occupied: true, frontier: true, partial: true },
      { className: "Boreal World", score: 0.6, occupied: false, frontier: false, partial: false },
    ];
    render(<HabitabilityPopoverBody growthMultiplier={0.93} fillOrder={fillOrder} />);

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
    render(<HabitabilityPopoverBody growthMultiplier={1} fillOrder={fillOrder} />);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent("Partial");
  });

  it("a dropped body is visible as a shorter list, not silently absorbed", () => {
    const fillOrder: FillOrderRow[] = [
      { className: "Jungle World", score: 0.7, occupied: true, frontier: true, partial: true },
    ];
    render(<HabitabilityPopoverBody growthMultiplier={0.7} fillOrder={fillOrder} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("an empty fill order (no habitable-land body) renders a stated absence, never a blank list", () => {
    render(<HabitabilityPopoverBody growthMultiplier={1} fillOrder={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/No habitable-land bodies/)).toBeInTheDocument();
    expect(screen.queryByText(/people-land/)).not.toBeInTheDocument();
  });
});
