import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndustryPanel, YieldPopoverBody, DepositPopoverBody } from "@/components/system/industry-panel";
import { depositRows } from "@/components/system/industry-rows";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DWELL_OPEN_DELAY_MS, DWELL_MS } from "@/components/ui/popover";
import { formatMagnitude } from "@/lib/utils/format";
import type { SystemIndustryData, SystemBuildOptionsData, SystemConstructionData } from "@/lib/types/api";

// The panel reads five hooks; mocking them at the module edge (same pattern as
// components/construction/__tests__/colony-section.test.tsx) is enough — no QueryClientProvider or
// worker/store wiring needed for a pure render-and-assert test.
const { industryValue } = vi.hoisted(() => {
  const industryValue: { current: SystemIndustryData } = { current: { visibility: "unknown" } };
  return { industryValue };
});

vi.mock("@/lib/hooks/use-system-industry", () => ({
  useSystemIndustry: () => industryValue.current,
}));
vi.mock("@/lib/hooks/use-system-info", () => ({
  useSystemInfo: () => ({ systemInfo: null, regionInfo: null }),
}));
vi.mock("@/lib/hooks/use-system-construction", () => ({
  useSystemConstruction: (): SystemConstructionData => ({ visibility: "hidden" }),
}));
vi.mock("@/lib/hooks/use-build-options", () => ({
  useSystemBuildOptions: (): SystemBuildOptionsData => ({ mode: "none" }),
}));
vi.mock("@/lib/hooks/use-construction-orders", () => ({
  useCancelOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));

/**
 * A two-budget readout deliberately shaped so the two budgets' figures never collide numerically:
 * people land (100 used / 300 total) is a housing-only story; the deposit budget (3 worked / 10
 * authored) is a separate, unrelated count. A "housing" building (tier -1) and a "metals" production
 * building (tier 1, count 5 / used 4) both sit in the buildings roster — the production building's
 * count/used numbers (4, 5) are the cross-contamination bait for Prove (1): if the people-land bar's
 * "used" figure ever summed housing with anything from the buildings roster again (the old
 * `GeneralLand.factory` shape this task deletes), the bar's rendered percentage would shift off the
 * value asserted below.
 */
const READOUT: SystemIndustryData = {
  visibility: "visible",
  unrest: 0.1,
  space: {
    people: { used: 100, total: 300 },
    deposit: { used: 3, total: 10 },
  },
  // yieldMult 1.15 (→ "115%") is deliberately distinct from every other percentage this fixture
  // renders elsewhere on the panel (labour fulfilment reads 100%) so the cell assertion below can't
  // collide with an unrelated figure.
  deposits: [{
    resource: "arable",
    depositCounts: 10,
    worked: 3,
    yieldMult: 1.15,
    marginal: { groundValue: 1.2, bodyType: "temperate_world" },
    workedByBody: [{ bodyType: "arid_world", worked: 3, groundValue: 1 }],
    band: "average",
  }],
  goods: [],
  popNeeds: [],
  labourFulfilment: 1,
  labour: {
    workforce: { have: 50, need: 50, fulfil: 1 },
    skill1: { have: 0, need: 0, fulfil: 1 },
    skill2: { have: 0, need: 0, fulfil: 1 },
  },
  labourAllocation: { population: 50, unskilled: 50, technicians: 0, engineers: 0, unemployed: 0 },
  buildings: [
    { buildingType: "housing", tier: -1, count: 20, used: 16, staffedFraction: 0.8 },
    { buildingType: "food", outputGood: "food", tier: 0, count: 3, used: 3, staffedFraction: 1, output: 9 },
    { buildingType: "metals", outputGood: "metals", tier: 1, count: 5, used: 4, staffedFraction: 0.8, output: 10 },
  ],
  supplyChain: [],
  skillBaskets: { technicians: [], engineers: [] },
};

function renderPanel() {
  return render(
    <TooltipProvider>
      <IndustryPanel systemId="s1" />
    </TooltipProvider>,
  );
}

describe("IndustryPanel — two-budget bars (people land, deposit land), industry-land vocabulary gone", () => {
  it("renders a Habitable land card whose bar reads housing's share of people land ALONE — a production building's count never bleeds in", () => {
    industryValue.current = READOUT;
    const { container } = renderPanel();

    expect(screen.getByText("Habitable land")).toBeInTheDocument();
    // 100/300 used, 200 free — if a factory/production figure ever folded into "used" again this
    // would shift (e.g. +4 used → 34.67% ≈ 35%, not 33%).
    expect(screen.getByRole("img", { name: "Composition: Housing 33%, Free 67%" })).toBeInTheDocument();
    expect(container.textContent).toContain(`${formatMagnitude(100)}/${formatMagnitude(300)}`);
    expect(container.textContent).toContain(`${formatMagnitude(200)} free`);
  });

  it("renders a Deposit land bar reading worked/authored COUNTS, never land units — the people-land figures (100/300/200) never appear there", () => {
    industryValue.current = READOUT;
    const { container } = renderPanel();

    expect(screen.getByText("Deposit land")).toBeInTheDocument();
    // 3 worked / 10 authored, 7 free — deliberately disjoint from the people-land numbers (100/300/200)
    // above, so a bar wired to the wrong budget would fail this assertion.
    expect(screen.getByRole("img", { name: "Composition: Worked 30%, Free 70%" })).toBeInTheDocument();
    expect(container.textContent).toContain(`${formatMagnitude(3)}/${formatMagnitude(10)} worked`);
    expect(container.textContent).toContain(`${formatMagnitude(7)} free`);
  });

  it("the deposit-row yield cell shows the worked average alone — a bare percentage, no marginal headline or slot-count line", () => {
    industryValue.current = READOUT;
    renderPanel();

    expect(screen.getByText("115%")).toBeInTheDocument();
    // The marginal/next-slot figure and the working-X-of-Y-slots line both moved into the
    // tooltip (see YieldPopoverBody below) — the cell itself must not carry either.
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/working \d+ of \d+ slots/)).not.toBeInTheDocument();
    expect(screen.queryByText("×1.15")).not.toBeInTheDocument();
  });

  it("YieldPopoverBody — combined figure, one line per contributing body, and the next slot", () => {
    // Real production join (depositRows) rather than a hand-typed DepositRow, so the fixture can't
    // drift from the shape the panel actually builds. Rendered directly rather than via a hovered
    // Tooltip trigger — Radix never mounts its portal content without an open interaction jsdom
    // can't reliably drive (same convention as habitability-popover-body.test.tsx).
    const [row] = depositRows(
      [{
        resource: "arable",
        depositCounts: 10,
        worked: 3,
        yieldMult: 1,
        marginal: { groundValue: 1.2, bodyType: "temperate_world" },
        workedByBody: [{ bodyType: "arid_world", worked: 3, groundValue: 1 }],
        band: "average",
      }],
      [],
      0,
      0.75,
    );
    const { container } = render(<YieldPopoverBody row={row} />);

    expect(container.textContent).toContain("Combined yield: 100%");
    expect(container.textContent).toContain("Arid World");
    expect(container.textContent).toContain("3 slots");
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Next slot: 120% on Temperate World");
  });

  it("YieldPopoverBody reads 'All deposit slots worked' instead of a next-slot line once nothing is left to build on", () => {
    const [row] = depositRows(
      [{ resource: "arable", depositCounts: 3, worked: 3, yieldMult: 1.4, marginal: null, workedByBody: [{ bodyType: "gaia_world", worked: 3, groundValue: 1.4 }], band: "good" }],
      [],
      0,
      0.75,
    );
    const { container } = render(<YieldPopoverBody row={row} />);

    expect(container.textContent).toContain("Combined yield: 140%");
    expect(container.textContent).toContain("All deposit slots worked");
    expect(container.textContent).not.toContain("Next slot:");
  });

  it("DepositPopoverBody no longer duplicates the Yield column's combined/next-slot figures — band, built/slots and staffed only", () => {
    // Same real production join as the YieldPopoverBody tests above, so this fixture can't drift
    // from the shape the panel actually builds. yieldMult 1.15 and marginal.groundValue 1.2 are the
    // duplication bait: pre-fix this tooltip rendered "avg 115%" and "Next 120%" — both figures the
    // Yield column's own tooltip (YieldPopoverBody) already owns.
    const [row] = depositRows(
      [{
        resource: "arable",
        depositCounts: 10,
        worked: 3,
        yieldMult: 1.15,
        marginal: { groundValue: 1.2, bodyType: "temperate_world" },
        workedByBody: [{ bodyType: "arid_world", worked: 3, groundValue: 1 }],
        band: "average",
      }],
      [],
      0,
      0.75,
    );
    const { container } = render(<DepositPopoverBody row={row} contributors={[]} />);

    expect(container.textContent).not.toContain("avg 115%");
    expect(container.textContent).not.toContain("Next 120%");
    expect(container.textContent).not.toContain("Fully worked");
    // What the tooltip DOES still own: band label, built/slots count, staffed.
    expect(container.textContent).toContain("Average");
    expect(container.textContent).toContain(`${row.built}/${row.depositCounts} slots built`);
    expect(container.textContent).toContain(`${row.staffed.toFixed(1)} staffed`);
  });

  it("never renders the retired industry-land vocabulary — no 'Industry land', 'General land', 'habitableFree' or 'factoryFree' anywhere in the DOM", () => {
    industryValue.current = READOUT;
    const { container } = renderPanel();

    expect(container.textContent).not.toContain("Industry land");
    expect(container.textContent).not.toContain("General land");
    expect(container.textContent).not.toContain("habitableFree");
    expect(container.textContent).not.toContain("factoryFree");
    expect(screen.queryByText("General land")).not.toBeInTheDocument();
  });
});

// Task 7 of docs/build-plans/nested-tooltips.md: the 6 TooltipTriggerLabel term triggers in this
// panel convert to dwell popovers, and YieldPopoverBody gains real TermLabel markup — the panel's
// first real chain. Real timers throughout, matching components/ui/__tests__/popover.test.tsx's own
// convention: Radix's FocusScope/Presence machinery is fragile under fake timers, and a locked
// `dwell` popover still renders through `PopoverPrimitive.Content`.
function setup() {
  return { user: userEvent.setup({ delay: null }) };
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Hovers `triggerName` and waits past the open grace and the dwell, so the popover it belongs to
 *  is `locked` by the time this resolves — same helper shape as popover.test.tsx's own. */
async function openLocked(user: ReturnType<typeof userEvent.setup>, triggerName: string) {
  await user.hover(screen.getByRole("button", { name: triggerName }));
  await wait(DWELL_OPEN_DELAY_MS + DWELL_MS + 80);
}

describe("IndustryPanel — nested-tooltips conversion (Task 7)", () => {
  it("renders with no popover open — none of the converted tooltips' content appears unbidden", () => {
    industryValue.current = READOUT;
    const { container } = renderPanel();

    // "Combined yield" only exists inside YieldPopoverBody, which only mounts once its popover is
    // open (Radix's Presence unmounts closed non-forced content entirely) — present on load would
    // mean a popover opened, or was forced open, without any interaction.
    expect(container.textContent).not.toContain("Combined yield");
    expect(screen.queryByText("Realised yield")).not.toBeInTheDocument();
  });

  it("the yield cell's dwell popover is reachable and readable, and its own 'Combined yield' term opens the Realised yield definition — the panel's first real chain", async () => {
    industryValue.current = READOUT;
    const { user } = setup();
    renderPanel();

    await openLocked(user, "115%");
    expect(await screen.findByText("Combined yield")).toBeInTheDocument();

    await openLocked(user, "Combined yield");
    expect(await screen.findByText("Realised yield")).toBeInTheDocument();
  });

  it("passing the pointer briefly over an intervening term inside the yield tooltip does not open that term's own popover — falsifier F1", async () => {
    // What this honestly pins: jsdom has no layout, so there is no real transit geometry here —
    // only the timing mechanism the dwell relies on as its second job (E1). A pointer that enters
    // and leaves an intervening trigger faster than the open grace never accumulates enough dwell
    // to open it, which is asserted directly. Whether a real cursor's path between a term and its
    // own popover physically crosses this trigger is what the owner's browser smoke (F1, run "where
    // it actually matters") checks instead.
    industryValue.current = READOUT;
    const { user } = setup();
    renderPanel();

    await openLocked(user, "115%");
    expect(await screen.findByText("Combined yield")).toBeInTheDocument();

    // The transit from "Combined yield" to its own popover passes over "Arid World" (the
    // `archetype` term two lines below it) without lingering there — moving straight on to the
    // destination trigger, the way a real cursor crossing a sibling trigger on its way somewhere
    // else would, rather than truly leaving the whole stack (which would tear down "Combined
    // yield" itself via the unrelated leave grace and make this test about the wrong mechanism).
    const intervening = screen.getByRole("button", { name: "Arid World" });
    const destination = screen.getByRole("button", { name: "Combined yield" });
    await user.hover(intervening);
    // Checked partway through the intervening trigger's own open grace (200ms), before moving on to
    // the destination — an implementation that opened it synchronously, or on a much shorter timer,
    // would already show its definition here. Moving straight to the destination without this
    // checkpoint would let the destination's own same-depth claim evict an already-open intervening
    // popover before the assertion ever ran, silently passing either way.
    await wait(50);
    expect(screen.queryByText("Archetype")).not.toBeInTheDocument();

    await user.hover(destination);
    // Long past the intervening trigger's own open grace and dwell — it still never opened.
    await wait(DWELL_OPEN_DELAY_MS + DWELL_MS + 80);
    expect(screen.queryByText("Archetype")).not.toBeInTheDocument();
    // The transit did not damage the chain it passed through on the way — the actual destination
    // term still locks open normally.
    expect(await screen.findByText("Realised yield")).toBeInTheDocument();
  });

  it("LegendTooltip stays a plain Tooltip — the control-help trigger the spec's rule keeps out of the conversion", async () => {
    // Radix's `Tooltip.Arrow` needs `ResizeObserver`, which jsdom doesn't provide — stubbed here,
    // same convention as components/ui/__tests__/term-label.test.tsx and
    // components/panels/__tests__/system-astrography.test.tsx.
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);

    industryValue.current = READOUT;
    const { user } = setup();
    renderPanel();

    const legendButton = screen.getByRole("button", { name: "Legend" });
    await user.hover(legendButton);
    // Radix Tooltip's own default open delay (no `delayDuration` override in this test's
    // `TooltipProvider`) — a real duration, not a shortened test double.
    await wait(900);
    // Radix Tooltip renders the content into two Presence copies while animating — `findAllByText`
    // rather than a singular lookup for exactly that reason, matching the rest of this file's own
    // convention for Radix-portalled content.
    expect((await screen.findAllByText("Health — mirrors what decays")).length).toBeGreaterThan(0);

    // A `dwell` popover renders a Pin control once locked (components/ui/popover.tsx); a plain
    // Radix Tooltip never does. Its absence here is the check that this trigger stayed a Tooltip
    // rather than converting to a dwell popover, checked against the spec's own rule (a control
    // stays a tooltip) rather than against the conversion count.
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();

    // The other half of the same rule: a trigger that describes a thing in the game (here, the
    // "metals" production building's own row) did convert, and shows the Pin control a `dwell`
    // popover carries once locked — the positive case beside the LegendTooltip's negative one.
    await openLocked(user, "Metals");
    expect(await screen.findByRole("button", { name: "Pin" })).toBeInTheDocument();
  });
});
