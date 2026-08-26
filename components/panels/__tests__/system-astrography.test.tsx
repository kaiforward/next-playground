import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { PotentialYieldTooltipBody } from "@/components/system/potential-yield-table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";
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
    // Label and value are queried separately (rather than a concatenated "Habitable land0" string)
    // because the figures now render as sibling dt/dd elements in an inline row instead of one text
    // node — this is what would break if the inline layout ever lost the label association.
    expect(screen.getByText("Habitable land", { selector: "dt" })).toBeInTheDocument();
    const dd = screen.getByText("Habitable land", { selector: "dt" }).nextElementSibling;
    expect(dd?.tagName).toBe("DD");
    expect(dd).toHaveTextContent("0");
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
          peopleLand: 500, occupied: true, orbitIndex: 1, size: 1,
        },
      ],
      potentialYields: [],
    };
    popValue = { visibility: "unknown" };
    renderPanel();
    const dd = screen.getByText("Habitable land", { selector: "dt" }).nextElementSibling;
    expect(dd?.tagName).toBe("DD");
    expect(dd).toHaveTextContent("1250");
    // The header's own habitable-land stat is absolute, never a percent — this system carries no
    // habitability read (popValue unknown), so the only "%" on the page comes from the body card's
    // own deposit-yield stat, not from the header.
    expect(screen.queryByText("Habitability")).not.toBeInTheDocument();
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
    renderPanel();
    const dd = screen.getByText("Habitability").nextElementSibling;
    expect(dd?.tagName).toBe("DD");
    expect(dd).toHaveTextContent("93%");
  });

  it("omits the habitability stat (never N/A, never a fabricated 100%) when the system has no assessment yet", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 300, bodies: [], potentialYields: [] };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();
    expect(screen.queryByText("Habitability")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("N/A");
  });

  it("an unscanned system renders the empty state, not a crash", () => {
    substrateValue = { visibility: "unknown" };
    popValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.getByText(/Scan this system/)).toBeInTheDocument();
  });
});

describe("SystemAstrography — the ring diagram", () => {
  it("renders the System section, with the body reachable by keyboard, when the system has bodies", async () => {
    const user = userEvent.setup({ delay: null });
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 480,
      bodies: [
        {
          id: "b1", bodyType: "temperate_world", archetypeName: "Temperate World",
          score: 1.0, locked: false,
          counts: emptyResourceVector(), quality: emptyResourceVector(), workedCounts: emptyResourceVector(),
          peopleLand: 480, occupied: false, orbitIndex: 1, size: 1,
        },
      ],
      potentialYields: [],
    };
    popValue = { visibility: "unknown" };
    renderPanel();

    // No standalone "System Map" heading any more — the ring diagram now sits directly in the
    // combined card, identified by its own body trigger rather than a section label.
    expect(screen.getByRole("button", { name: "Temperate World" })).toBeInTheDocument();
    await user.tab();
    // "Temperate World" also headlines the body card below — scoped to the opened popover's own
    // dialog (its `aria-label`) so this asserts the diagram's OWN wiring, not the card grid's.
    const dialog = await screen.findByRole("dialog", { name: "Temperate World" });
    expect(within(dialog).getByRole("heading", { name: "Temperate World" })).toBeInTheDocument();
  });

  it("renders no System section when the system has no charted bodies", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [], potentialYields: [] };
    popValue = { visibility: "unknown" };
    const { container } = renderPanel();
    // No ring diagram at all — assert the SVG the diagram renders into is absent, not just one
    // body's trigger (there are no bodies to have one).
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});

describe("SystemAstrography — the body list", () => {
  it("renders every body once, with its name, occupied badge and deposit text, in one shared card", () => {
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 780,
      bodies: [
        {
          id: "b1", bodyType: "temperate_world", archetypeName: "Temperate World",
          score: 1.0, locked: false,
          counts: makeResourceVector({ ore: 2 }), quality: makeResourceVector({ ore: 0.8 }), workedCounts: makeResourceVector({ ore: 1 }),
          peopleLand: 480, occupied: true, orbitIndex: 1, size: 1,
        },
        {
          id: "b2", bodyType: "volcanic_world", archetypeName: "Volcanic World",
          score: 0.4, locked: false,
          counts: emptyResourceVector(), quality: emptyResourceVector(), workedCounts: emptyResourceVector(),
          peopleLand: 300, occupied: false, orbitIndex: 2, size: 1,
        },
      ],
      potentialYields: [],
    };
    popValue = { visibility: "unknown" };
    renderPanel();

    // Each body's own name heading — the list card renders one `BodyReadout` per row.
    expect(screen.getByRole("heading", { name: "Temperate World" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Volcanic World" })).toBeInTheDocument();
    // Only the occupied body carries the badge — a marking on both would fail this.
    expect(screen.getAllByText("Occupied")).toHaveLength(1);
    // The occupied body's own deposit text (worked/total slots), proving the row renders its
    // full readout rather than a name-only summary.
    expect(screen.getByText("1/2 worked")).toBeInTheDocument();
  });

  it("shows the zero-body empty state, not an empty card", () => {
    substrateValue = { visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [], potentialYields: [] };
    popValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.getByText("No charted bodies in this system.")).toBeInTheDocument();
  });
});

describe("SystemAstrography — potential-yield header tooltip", () => {
  it("keeps the yield explanation out of the layout and reachable only through the header's tooltip trigger", async () => {
    // Radix's `Tooltip.Arrow` needs `ResizeObserver`, which jsdom doesn't provide — stubbed here,
    // local to this test, so the tooltip can actually be driven open rather than only asserting the
    // trigger exists (the convention elsewhere in this repo, e.g. `industry-panel.test.tsx`,
    // `habitability-tooltip-content.test.tsx`, where the content is instead rendered directly).
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);

    const user = userEvent.setup({ delay: null });
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [],
      potentialYields: [{ resource: "ore", yieldMult: 0.72, slotCount: 5, band: "average", byBody: [] }],
    };
    popValue = { visibility: "unknown" };
    renderPanel();

    const explanation = /What this system could produce if every body here were fully developed/;
    // Not rendered as inline prose any more.
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();

    // The "Potential yield" header is itself the tooltip's keyboard-reachable trigger — a real
    // `<button>`, focusable and opened by Tab like any other control.
    const trigger = screen.getByRole("button", { name: "Potential yield" });
    await user.tab();
    expect(trigger).toHaveFocus();
    // Radix renders the tooltip's copy twice (a visible node plus a visually-hidden
    // `role="tooltip"` one for screen readers) — assert on the accessible tooltip role rather than
    // the text, which would otherwise match both.
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(explanation);
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
