import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContributorBars } from "@/components/ui/contributor-bars";

// The width maths lives in `contributor-bars-helpers` and is tested there, against numbers rather
// than against markup. What is left for the DOM is what a reader actually gets: one labelled row
// per contributor, printing the TRUE reading.

describe("ContributorBars", () => {
  it("renders a labelled row per contributor with its rounded percentage", () => {
    render(
      <ContributorBars
        contributors={[
          { label: "Goods shortfall", value: 0.4, color: "red" },
          { label: "Tax pressure", value: 0.1, color: "blue" },
        ]}
        total={1}
      />,
    );
    expect(screen.getByText("Goods shortfall")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Tax pressure")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("a contributor above the scale prints its TRUE value, not the clamped one", () => {
    // The bar is full either way; the printed figure is the only thing that separates "at the
    // ceiling" from "far past it".
    render(
      <ContributorBars contributors={[{ label: "Goods shortfall", value: 2.4, color: "red" }]} total={1} />,
    );
    expect(screen.getByText("240%")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("a zero scale renders real rows with no NaN reaching the markup", () => {
    const { container } = render(
      <ContributorBars contributors={[{ label: "Goods shortfall", value: 0.4, color: "red" }]} total={0} />,
    );
    expect(screen.getByText("Goods shortfall")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    // Markup, not text: a divide-by-zero would surface as a `width: NaN%` style first.
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.innerHTML).not.toContain("Infinity");
  });
});
