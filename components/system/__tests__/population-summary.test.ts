import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PopulationSummary } from "@/components/system/population-summary";

describe("PopulationSummary — occupancy bar, crowding chip, and the housed/over-capacity/capacity key", () => {
  it("comfortable occupancy: no overshoot segment (the key's amber swatch is the only amber block), comfortable chip", () => {
    const html = renderToStaticMarkup(PopulationSummary({ population: 500, popCap: 1000 }));
    expect(html).toContain("Comfortable");
    // "bg-status-amber" appears exactly once — the key legend's swatch — because the overshoot
    // track segment is conditionally omitted, not rendered at 0 width.
    expect(html.split("bg-status-amber").length - 1).toBe(1);
    // the three key entries always render
    expect(html).toContain("Housed");
    expect(html).toContain("Over capacity");
    expect(html).toContain("Capacity");
  });

  it("overshoot past capacity renders a track segment AND the amber-toned Crowding chip", () => {
    const html = renderToStaticMarkup(PopulationSummary({ population: 1100, popCap: 1000 }));
    expect(html).toContain("Crowding");
    // key swatch + chip tint + track segment — one more "bg-status-amber" occurrence than the
    // comfortable case, which has only the key swatch (chip there is green, no track segment).
    expect(html.split("bg-status-amber").length - 1).toBe(3);
  });

  it("a popCap <= 0 system with residents renders a real bar — 0% housed, braked chip — not a crash", () => {
    const html = renderToStaticMarkup(PopulationSummary({ population: 500, popCap: 0 }));
    expect(html).toContain("Braked");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
