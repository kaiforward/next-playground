import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PopulationPanel } from "@/components/system/population-panel";
import { DWELL_OPEN_DELAY_MS, DWELL_MS } from "@/components/ui/popover";
import type { SystemPopulationData, SystemUnrestRead } from "@/lib/types/api";

// The Population tab's growth line ("Habitability: 93%") is a straight FORMAT of the service's
// `growthMultiplier` — this component computes nothing, so a bad service value (NaN, non-1.0) must
// be visible in the DOM text exactly as the service handed it over.

let popValue: SystemPopulationData = { visibility: "unknown" };
vi.mock("@/lib/hooks/use-system-population", () => ({
  useSystemPopulation: () => popValue,
}));

const UNASSESSED_UNREST: SystemUnrestRead = {
  assessed: false,
  contributors: { tax: 0, crowding: 0 },
  strikeThreshold: 0.8,
};

function populated(overrides: Partial<Extract<SystemPopulationData, { visibility: "visible" }>> = {}) {
  const base: Extract<SystemPopulationData, { visibility: "visible" }> = {
    visibility: "visible",
    population: 500,
    popCap: 1000,
    unrest: 0.1,
    striking: false,
    needs: [],
    provision: { assessed: false },
    unrestBreakdown: UNASSESSED_UNREST,
    growthMultiplier: 0.93,
    fillOrder: [
      { className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: true },
      { className: "Arid World", score: 0.35, peopleLand: 200, occupied: false, frontier: false },
    ],
  };
  return { ...base, ...overrides };
}

function renderPanel() {
  return render(<PopulationPanel systemId="s1" />);
}

/** Same helper shape as `industry-panel.test.tsx`'s own — hovers a trigger and waits past the
 *  open grace and the dwell, so the `dwell` popover it belongs to is `locked` by the time this
 *  resolves. Real timers, matching `components/ui/__tests__/popover.test.tsx`'s own convention. */
async function openLocked(user: ReturnType<typeof userEvent.setup>, triggerName: string | RegExp) {
  await user.hover(screen.getByRole("button", { name: triggerName }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
  });
}

describe("PopulationPanel — the growth line", () => {
  it("renders the service's growthMultiplier, format-only — a NaN service value is visible in DOM text", () => {
    popValue = populated({ growthMultiplier: NaN });
    const { container } = renderPanel();
    expect(container.textContent).toContain("NaN%");
  });

  it("renders the exact service multiplier as a percentage, unmodified", () => {
    popValue = populated({ growthMultiplier: 0.93 });
    renderPanel();
    expect(screen.getByRole("button", { name: /Habitability/ })).toHaveTextContent("93%");
  });

  it("a single-body quality-1.0 world still renders the line at 100% — the common case is not hidden", () => {
    popValue = populated({
      growthMultiplier: 1,
      fillOrder: [{ className: "Temperate World", score: 1.0, peopleLand: 480, occupied: true, frontier: true }],
    });
    renderPanel();
    expect(screen.getByRole("button", { name: /Habitability/ })).toHaveTextContent("100%");
  });

  it("an uninhabited system renders no growth line", () => {
    popValue = { visibility: "unknown" };
    renderPanel();
    expect(screen.queryByText(/Habitability/)).not.toBeInTheDocument();
  });

  it("a genuinely uninhabited (visible but empty) system also renders no growth line", () => {
    popValue = populated({ population: 0, popCap: 0, unrest: 0 });
    renderPanel();
    expect(screen.queryByText(/Habitability/)).not.toBeInTheDocument();
  });

  it("opens the growth line's own dwell popover, naming the contributing bodies, and a body row's own Archetype term opens a second level from it — Task 8's conversion of GrowthLine to PopoverTriggerLabel", async () => {
    const user = userEvent.setup({ delay: null });
    popValue = populated({
      growthMultiplier: 0.93,
      fillOrder: [{ className: "Jungle World", score: 0.7, peopleLand: 300, occupied: true, frontier: true }],
    });
    renderPanel();

    await openLocked(user, /Habitability/);
    expect(await screen.findByText("Habitability: 93%")).toBeInTheDocument();

    await openLocked(user, "Jungle World");
    expect(await screen.findByText("Archetype")).toBeInTheDocument();
  });
});
