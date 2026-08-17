import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompositionBar } from "@/components/ui/composition-bar";

describe("CompositionBar — width math and a11y", () => {
  it("a zero-total set announces every segment at 0% (no NaN)", () => {
    const { container } = render(
      <CompositionBar
        segments={[
          { label: "A", value: 0, color: "red" },
          { label: "B", value: 0, color: "blue" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Composition: A 0%, B 0%" })).toBeInTheDocument();
    // Markup, not text content: a divide-by-zero surfaces as a `width: NaN%` style first.
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.innerHTML).not.toContain("Infinity");
  });
});
