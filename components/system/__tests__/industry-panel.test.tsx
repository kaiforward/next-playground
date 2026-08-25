import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndustryPanel } from "@/components/system/industry-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  deposits: [{ resource: "arable", depositCounts: 10, worked: 3, yieldMult: 1, marginal: { groundValue: 1.2 }, band: "average" }],
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

  it("headlines the marginal (next-slot) yield as a whole percentage, with the worked average as a secondary line — never the raw multiplier", () => {
    industryValue.current = READOUT;
    renderPanel();

    expect(screen.getByText("Next: 120%")).toBeInTheDocument();
    expect(screen.getByText("working 3 of 10 slots · avg 100%")).toBeInTheDocument();
    expect(screen.queryByText("×1.20")).not.toBeInTheDocument();
  });

  it("a fully-worked resource (marginal null) renders 'Fully worked' as the headline, never a 100% stand-in", () => {
    // The "food" extractor in READOUT.buildings has count 3, so depositCounts:3/worked:3 (via
    // depositRows' own built/depositCounts join) genuinely reads as fully worked, not a fixture
    // whose summary and buildings roster disagree.
    industryValue.current = {
      ...READOUT,
      deposits: [{ resource: "arable", depositCounts: 3, worked: 3, yieldMult: 1.4, marginal: null, band: "good" }],
    };
    renderPanel();

    expect(screen.getByText("Fully worked")).toBeInTheDocument();
    expect(screen.getByText("working 3 of 3 slots · avg 140%")).toBeInTheDocument();
    // No "Next: N%" headline anywhere — a fully-worked resource must not fall back to a percentage.
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
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
