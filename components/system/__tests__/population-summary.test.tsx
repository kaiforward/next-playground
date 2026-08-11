import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PopulationSummary } from "@/components/system/population-summary";

describe("PopulationSummary — occupancy bar, crowding chip, and the housed/over-capacity/capacity key", () => {
  /**
   * The amber fills, counted as elements rather than as substrings of the markup. Two carry amber:
   * the key legend's swatch, always, and the overshoot track segment, only when there IS overshoot.
   * The crowding chip is not among them — its tint is `bg-status-amber/20`, a different class.
   */
  const amberFills = (container: HTMLElement): NodeListOf<Element> =>
    container.querySelectorAll(".bg-status-amber");

  it("comfortable occupancy: no overshoot segment at all, and a comfortable chip", () => {
    const { container } = render(<PopulationSummary population={500} popCap={1000} />);
    expect(screen.getByText("Comfortable")).toBeInTheDocument();
    // One amber element — the key's swatch. The overshoot segment is conditionally omitted, not
    // rendered at zero width, which is the distinction this test exists for.
    expect(amberFills(container)).toHaveLength(1);
    // The three key entries always render. Scoped to the key row, because "Capacity" is also the
    // label of the stat row above it — an unscoped query matches both.
    const key = screen.getByText("Housed").closest("div");
    expect(key).toHaveTextContent("Over capacity");
    expect(key).toHaveTextContent("Capacity");
  });

  it("overshoot past capacity renders a track segment AND the amber-toned Crowding chip", () => {
    const { container } = render(<PopulationSummary population={1100} popCap={1000} />);
    expect(screen.getByText("Crowding")).toBeInTheDocument();
    // Two now: the key swatch plus the overshoot segment the comfortable case has no element for.
    expect(amberFills(container)).toHaveLength(2);
  });

  it("a popCap <= 0 system with residents renders a real bar — braked chip — not a crash", () => {
    const { container } = render(<PopulationSummary population={500} popCap={0} />);
    expect(screen.getByText("Braked")).toBeInTheDocument();
    // Markup, not text content: a divide-by-zero surfaces as a `width: NaN%` style, which never
    // reaches the rendered text.
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.innerHTML).not.toContain("Infinity");
  });
});
