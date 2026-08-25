import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { PotentialYieldTooltipBody } from "@/components/system/potential-yield-table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { SystemPopulationData, SystemSubstrateData } from "@/lib/types/api";
import type { PotentialYieldRowView } from "@/lib/utils/substrate";

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
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [], potentialYields: [] };
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
          counts: emptyResourceVector(), quality: emptyResourceVector(), workedCounts: emptyResourceVector(),
          peopleLand: 500, occupied: true,
        },
      ],
      potentialYields: [],
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
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 300, bodies: [], potentialYields: [] };
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
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 300, bodies: [], potentialYields: [] };
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

describe("SystemAstrography — potential-yield table", () => {
  it("renders one row per resource with a slot, its potential-yield percentage and slot count as text", () => {
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [],
      potentialYields: [
        { resource: "ore", yieldMult: 0.72, slotCount: 5, band: "average", byBody: [] },
      ],
    };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();

    // "Potential yield" appears twice — the section heading and the yield column header — so
    // assert on the heading specifically.
    expect(screen.getByRole("heading", { name: "Potential yield" })).toBeInTheDocument();
    expect(screen.getByText("ore")).toBeInTheDocument();
    expect(container.textContent).toContain("72%");
    expect(container.textContent).toContain("5");
  });

  it("renders no potential-yield table (and no heading) when the system has no deposits anywhere", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [], potentialYields: [] };
    popValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.queryByText("Potential yield")).not.toBeInTheDocument();
  });

  it("PotentialYieldTooltipBody marks a locked body's breakdown line as locked, an unlocked one as not", () => {
    // Rendered directly rather than via a hovered Tooltip trigger — Radix never mounts its portal
    // content without an open interaction jsdom can't reliably drive (same convention as
    // industry-panel.test.tsx's YieldTooltipBody tests).
    const row: PotentialYieldRowView = {
      resource: "ore", yieldMult: 0.63, slotCount: 3, band: "average",
      byBody: [
        { bodyId: "b0", archetypeName: "Temperate World", slotCount: 1, groundValue: 0.9, locked: false },
        { bodyId: "b1", archetypeName: "Volcanic World", slotCount: 2, groundValue: 0.36, locked: true },
      ],
    };
    const { container } = render(<PotentialYieldTooltipBody row={row} />);

    expect(container.textContent).toContain("Temperate World");
    expect(container.textContent).toContain("Volcanic World");
    expect(screen.getByText("Locked")).toBeInTheDocument();
    // Only ONE locked marker — the unlocked body's line carries none.
    expect(screen.getAllByText("Locked")).toHaveLength(1);
  });
});
