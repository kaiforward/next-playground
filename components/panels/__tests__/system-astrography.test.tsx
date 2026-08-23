import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { SystemSubstrateData } from "@/lib/types/api";

let substrateValue: SystemSubstrateData = { visibility: "unknown" };
vi.mock("@/lib/hooks/use-system-substrate", () => ({
  useSystemSubstrate: () => substrateValue,
}));

function renderPanel() {
  return render(
    <TooltipProvider>
      <SystemAstrography systemId="s1" />
    </TooltipProvider>,
  );
}

describe("SystemAstrography — the system-level people-land header, absolute not percent", () => {
  it("a zero-people-land system reads a bare 0, never NaN or a percent", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [] };
    const { container } = renderPanel();
    expect(container.textContent).toContain("People land0");
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.textContent).not.toContain("%");
  });

  it("a populated system reads the absolute people land across its bodies", () => {
    substrateValue = {
      visibility: "visible",
      sunClass: "yellow",
      peopleLand: 1250,
      bodies: [
        {
          id: "b1", bodyType: "temperate_world", archetypeName: "Temperate World",
          score: 1.0, locked: false, size: 1.1,
          counts: emptyResourceVector(), quality: emptyResourceVector(),
          peopleLand: 500, industryLand: 200, extractionModifier: 1.0, occupied: true,
        },
      ],
    };
    const { container } = renderPanel();
    expect(container.textContent).toContain("People land1250");
    expect(container.textContent).not.toContain("%");
  });

  it("an unscanned system renders the empty state, not a crash", () => {
    substrateValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.getByText(/Scan this system/)).toBeInTheDocument();
  });
});
