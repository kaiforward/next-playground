import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { SystemPopulationData, SystemSubstrateData } from "@/lib/types/api";

let substrateValue: SystemSubstrateData = { visibility: "unknown" };
vi.mock("@/lib/hooks/use-system-substrate", () => ({
  useSystemSubstrate: () => substrateValue,
}));

let popValue: SystemPopulationData = { visibility: "unknown" };
vi.mock("@/lib/hooks/use-system-population", () => ({
  useSystemPopulation: () => popValue,
}));

function renderPanel() {
  return render(
    <TooltipProvider>
      <SystemAstrography systemId="s1" />
    </TooltipProvider>,
  );
}

describe("SystemAstrography — the system-level habitable-land header, absolute not percent", () => {
  it("a zero-habitable-land system reads a bare 0, never NaN or a percent", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [] };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();
    expect(container.textContent).toContain("Habitable land0");
    expect(container.textContent).not.toContain("People land");
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.textContent).not.toContain("%");
  });

  it("a populated system reads the absolute habitable land across its bodies", () => {
    substrateValue = {
      visibility: "visible",
      sunClass: "yellow",
      peopleLand: 1250,
      bodies: [
        {
          id: "b1", bodyType: "temperate_world", archetypeName: "Temperate World",
          score: 1.0, locked: false,
          counts: emptyResourceVector(), quality: emptyResourceVector(),
          peopleLand: 500, occupied: true,
        },
      ],
    };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();
    expect(container.textContent).toContain("Habitable land1250");
    // The header's own habitable-land stat is absolute, never a percent — this system carries no
    // habitability read (popValue unknown), so the only "%" on the page comes from the body card's
    // own deposit-yield stat, not from the header.
    expect(container.textContent).not.toContain("Habitability");
  });

  it("shows the system's habitability percentage next to habitable land, reusing the population service's growthMultiplier", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 300, bodies: [] };
    popValue = {
      visibility: "visible",
      population: 100,
      popCap: 500,
      unrest: 0,
      striking: false,
      needs: [],
      provision: { assessed: false },
      unrestBreakdown: { assessed: false, contributors: { tax: 0, crowding: 0 }, strikeThreshold: 0.8 },
      growthMultiplier: 0.93,
      fillOrder: [],
    };
    const { container } = renderPanel();
    expect(container.textContent).toContain("Habitability93%");
  });

  it("omits the habitability stat (never N/A, never a fabricated 100%) when the system has no assessment yet", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 300, bodies: [] };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();
    expect(container.textContent).not.toContain("Habitability");
    expect(container.textContent).not.toContain("N/A");
  });

  it("an unscanned system renders the empty state, not a crash", () => {
    substrateValue = { visibility: "unknown" };
    popValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.getByText(/Scan this system/)).toBeInTheDocument();
  });
});
