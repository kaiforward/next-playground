import { describe, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { PotentialYieldTooltipBody } from "@/components/system/potential-yield-table";
import { DWELL_OPEN_DELAY_MS, DWELL_MS } from "@/components/ui/popover";
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
  return render(<SystemAstrography systemId="s1" />);
}

/** Hovers `triggerName` and waits past the open grace and the dwell, so the `dwell` popover it
 *  belongs to is `locked` by the time this resolves — same helper shape as
 *  `industry-panel.test.tsx`'s own. Real timers, matching `components/ui/__tests__/popover.test.tsx`'s
 *  own convention. */
async function openLocked(user: ReturnType<typeof userEvent.setup>, triggerName: string) {
  await user.hover(screen.getByRole("button", { name: triggerName }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
  });
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
    // The header's habitable-land stat is absolute, never a percent. That the header OMITS its
    // habitability stat when there is no assessment is pinned by its own test below, on a
    // body-less system — the header cannot be isolated by text here, because every body row now
    // labels its own habitability with the same word.
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
    // The label is now a tooltip trigger (a `<button>`) sitting inside the `<dt>` rather than being
    // the `<dt>` itself, so the dd is found off the dt, not off the button's own (nonexistent)
    // sibling.
    const trigger = screen.getByRole("button", { name: "Habitability" });
    const dt = trigger.closest("dt");
    expect(dt).not.toBeNull();
    const dd = dt?.nextElementSibling;
    expect(dd?.tagName).toBe("DD");
    expect(dd).toHaveTextContent("93%");
  });

  it("opens the habitability figure's breakdown popover, naming the contributing bodies, and a body row's own Archetype term opens a second level — Task 8's conversion from a plain Tooltip to a PopoverTriggerLabel keeping HabitabilityTooltipContent as its body", async () => {
    const user = userEvent.setup({ delay: null });
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
      fillOrder: [
        { className: "Temperate World", score: 1.0, occupied: true, frontier: true, partial: true },
      ],
    };
    renderPanel();

    await openLocked(user, "Habitability");
    expect(await screen.findByText("Habitability: 93%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Temperate World" })).toBeInTheDocument();

    // A second level: the body row's own name is an `archetype` term, opening its own definition.
    await openLocked(user, "Temperate World");
    expect(await screen.findByText("Archetype")).toBeInTheDocument();
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

describe("SystemAstrography — the sun-class heading", () => {
  it("uppercases the sun-class name but leaves its bracketed descriptor as authored", () => {
    substrateValue = { visibility: "visible", sunClass: "blue_white", peopleLand: 0, bodies: [], potentialYields: [] };
    popValue = { visibility: "unknown" };
    renderPanel();
    // The casing is applied in CSS to the name only, so the DOM text — and therefore the
    // accessible name — stays exactly as authored: "Blue–white (hot)"
    // (`SUN_CLASSES.blue_white.name`). What this pins is the SPLIT: the bracket must be a separate
    // text node from the uppercased span, which is what lets CSS case one and not the other.
    const heading = screen.getByRole("heading", { name: "Blue–white (hot)" });
    expect(heading).toBeInTheDocument();
    expect(heading.querySelector("span")).toHaveTextContent("Blue–white");
    expect(heading.querySelector("span")).not.toHaveTextContent("(hot)");
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

describe("SystemAstrography — potential-yield header term", () => {
  it("keeps the yield definition out of the layout and reachable only through the header's own TermLabel — Task 8's conversion from an inline-explanation Tooltip to the fixed glossary definition", async () => {
    const user = userEvent.setup({ delay: null });
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [],
      potentialYields: [{ resource: "ore", yieldMult: 0.72, slotCount: 5, band: "average", byBody: [] }],
    };
    popValue = { visibility: "unknown" };
    renderPanel();

    // The old hardcoded inline-prose explanation is gone — the definition now lives once, in
    // `lib/glossary/terms.ts`, and only renders once its own popover opens.
    const oldExplanation = /What this system could produce if every body here were fully developed/;
    expect(screen.queryByText(oldExplanation)).not.toBeInTheDocument();

    // The "Potential yield" header is itself the term's keyboard-reachable trigger — a real
    // `<button>`, focusable and opened by Tab like any other control.
    const trigger = screen.getByRole("button", { name: "Potential yield" });
    await user.tab();
    expect(trigger).toHaveFocus();
    // Keyboard focus opens a `dwell` popover locked immediately — no open grace or dwell to wait
    // out (`Popover`'s own docblock, "keyboard opens a dwell popover locked").
    const dialog = await screen.findByRole("dialog", { name: "Potential yield" });
    expect(dialog).toHaveTextContent(/would give with every slot in the system/);
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

  it("opens the resource cell's own popover, and a body row's Archetype/Resource slot/Quality band terms each open a second level — Task 8's conversion of the resource cell to PopoverTriggerLabel", async () => {
    const user = userEvent.setup({ delay: null });
    substrateValue = {
      visibility: "visible", sunClass: "yellow", peopleLand: 0, bodies: [],
      potentialYields: [
        {
          resource: "ore", yieldMult: 0.72, slotCount: 1, band: "average",
          byBody: [{ bodyId: "b0", archetypeName: "Temperate World", slotCount: 1, groundValue: 0.9, locked: false }],
        },
      ],
    };
    popValue = { visibility: "unknown" };
    renderPanel();

    await openLocked(user, "ore");
    expect(await screen.findByRole("button", { name: "Temperate World" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "slot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "90%" })).toBeInTheDocument();

    await openLocked(user, "Temperate World");
    expect(await screen.findByText("Archetype")).toBeInTheDocument();
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
