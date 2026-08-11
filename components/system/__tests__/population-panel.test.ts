import { describe, it, expect } from "vitest";
import { populationPanelView } from "@/components/system/population-panel";

describe("populationPanelView — which state the Population tab renders", () => {
  it("a genuinely uninhabited system (no residents, no unrest, no housing) is uninhabited", () => {
    expect(populationPanelView({ population: 0, popCap: 0, unrest: 0 })).toBe("uninhabited");
  });

  it("popCap <= 0 WITH residents is populated, not uninhabited — collapsed housing stranding a population", () => {
    expect(populationPanelView({ population: 50, popCap: 0, unrest: 0 })).toBe("populated");
    expect(populationPanelView({ population: 50, popCap: -10, unrest: 0 })).toBe("populated");
  });

  it("popCap <= 0 WITH standing unrest but no residents is still populated", () => {
    expect(populationPanelView({ population: 0, popCap: 0, unrest: 0.3 })).toBe("populated");
  });

  it("a normal system with real capacity is always populated", () => {
    expect(populationPanelView({ population: 1000, popCap: 1200, unrest: 0.1 })).toBe("populated");
    expect(populationPanelView({ population: 0, popCap: 1200, unrest: 0 })).toBe("populated");
  });
});
