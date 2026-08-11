import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContributorBars } from "@/components/ui/contributor-bars";

// No jsdom in the `unit` project — render to a static HTML string with react-dom/server
// (pure node, no DOM) and assert on the real markup, same pattern as vital-tile.test.ts.

describe("ContributorBars — one scaled bar per contributor", () => {
  it("widths are value/total, clamped to 100%, with a threshold marker at its own scaled position", () => {
    const html = renderToStaticMarkup(
      ContributorBars({
        segments: [
          { label: "Goods shortfall", value: 0.4, color: "#f59e0b" },
          { label: "Tax pressure", value: 0.1, color: "#3b82f6" },
          { label: "Crowding", value: 0.05, color: "#a855f7" },
        ],
        total: 1,
        threshold: 0.65,
      }),
    );
    expect(html).toContain("Goods shortfall");
    expect(html).toContain("Tax pressure");
    expect(html).toContain("Crowding");
    expect(html).toContain("width:40%"); // 0.4/1
    expect(html).toContain("width:10%"); // 0.1/1
    expect(html).toContain("width:5%"); // 0.05/1
    expect(html).toContain("left:65%"); // threshold/total
    expect(html).toContain("background:#f59e0b");
  });

  it("a segment reading above total still renders a full bar, not an overflowing width", () => {
    const html = renderToStaticMarkup(
      ContributorBars({
        segments: [{ label: "Goods shortfall", value: 1.4, color: "#f59e0b" }],
        total: 1,
      }),
    );
    expect(html).toContain("width:100%");
    expect(html).not.toContain("width:140%");
  });

  it("total <= 0 renders every bar at 0% rather than dividing by zero", () => {
    const html = renderToStaticMarkup(
      ContributorBars({
        segments: [
          { label: "A", value: 5, color: "red" },
          { label: "B", value: 0, color: "blue" },
        ],
        total: 0,
      }),
    );
    expect(html).toContain("width:0%");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("omitting threshold draws no marker", () => {
    const html = renderToStaticMarkup(
      ContributorBars({ segments: [{ label: "A", value: 5, color: "red" }], total: 10 }),
    );
    expect(html).not.toContain("bg-text-primary/60");
  });
});
