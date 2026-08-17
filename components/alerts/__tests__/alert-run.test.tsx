import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AlertRunContent } from "@/components/alerts/alert-run";
import { CHIP_WIDTH, SPACED_GAP, OVERLAP_FLOOR, CRITICAL_STACK_OVERLAP, PLUS_N_WIDTH } from "@/lib/utils/alert-packing";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { AlertData, SystemScopedAlertCategory } from "@/lib/types/api";

// AlertRunContent is the half of the run with no DOM measurement anywhere in it or below it — see
// its own docstring. Every test here renders it directly with a literal `availableWidth`; none of
// them render `AlertRun` itself (the measuring wrapper), which needs a real `ResizeObserver` jsdom
// doesn't implement, and would render an empty run at width 0 in every test that tried — the exact
// vacuity AGENTS.md's testing section warns about.

vi.mock("@/lib/hooks/use-tick-context", () => ({
  useTickContext: () => ({ currentTick: transport.currentTick }),
}));

const transport = { currentTick: 0 };

let alertsData: AlertData;
vi.mock("@/lib/hooks/use-alerts", () => ({
  useAlerts: () => alertsData,
}));

function scoped(
  id: SystemScopedAlertCategory["id"],
  count: number,
  denominator = 253,
): SystemScopedAlertCategory {
  return { id, unit: "developed_systems", count, denominator, instances: [] };
}

beforeEach(() => {
  transport.currentTick = 0;
  alertsData = { categories: [] };
});

/** How much space `n` chips need at a given packing gap — the same algebra `packRun` itself uses,
 *  so a test can compute an exact boundary instead of guessing a width that's "probably enough". */
function widthFor(n: number, gap: number): number {
  return n <= 0 ? 0 : n * CHIP_WIDTH + Math.max(0, n - 1) * gap;
}

/** Asserts the rendered chip buttons carry `names`, front to back — order AND content in one
 *  check, via jest-dom's own accessible-name matcher rather than a hand-rolled computation. */
function expectButtonNamesInOrder(names: string[]): void {
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(names.length);
  buttons.forEach((button, i) => expect(button).toHaveAccessibleName(names[i]));
}

describe("AlertRunContent — renders the live categories, in the order useAlerts already sorted them", () => {
  it("renders one chip per nonzero category with its accessible name, front to back", () => {
    alertsData = {
      categories: [scoped("famine", 3), scoped("strike", 2), scoped("deprived_worlds", 1)],
    };
    render(<AlertRunContent availableWidth={widthFor(3, SPACED_GAP) + 50} />);

    expectButtonNamesInOrder([
      "Famine, 3 of 253 developed systems",
      "Strike, 2 of 253 developed systems",
      "Deprived worlds, 1 of 253 developed systems",
    ]);
  });

  it("a category with a zero count and no prior history renders no chip at all", () => {
    alertsData = { categories: [scoped("famine", 0)] };
    render(<AlertRunContent availableWidth={500} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("AlertRunContent — chip order does not change when a count changes", () => {
  it("keeps the same front-to-back order across a re-render with different counts", () => {
    alertsData = { categories: [scoped("famine", 2), scoped("strike", 9)] };
    const { rerender } = render(<AlertRunContent availableWidth={500} />);
    expectButtonNamesInOrder(["Famine, 2 of 253 developed systems", "Strike, 9 of 253 developed systems"]);

    // Strike's count now dwarfs Famine's — if anything ever sorted by count, this is the render
    // that would move it first.
    alertsData = { categories: [scoped("famine", 25), scoped("strike", 1)] };
    rerender(<AlertRunContent availableWidth={500} />);
    expectButtonNamesInOrder(["Famine, 25 of 253 developed systems", "Strike, 1 of 253 developed systems"]);
  });
});

describe("AlertRunContent — below the width that fits the critical tier plus a +N, nothing renders", () => {
  it("renders no chips and no collapsed tail at a width that fits nothing", () => {
    alertsData = { categories: [scoped("famine", 4)] };
    render(<AlertRunContent availableWidth={1} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("renders no DOM at all — not an empty container — matching 'nothing reserves layout height'", () => {
    // Distinct from the assertion above: an empty-but-present wrapper element would also show no
    // button and no "+" text, so that test alone can't tell a real `return null` from a container
    // that merely ended up with no children this render. The run is meant to not exist in the DOM
    // at all when it has nothing to show (docs/build-plans/alert-bar.md → "Nothing reserves layout
    // height"), so this checks the container itself is empty, not just its interactive contents.
    alertsData = { categories: [scoped("famine", 4)] };
    const { container } = render(<AlertRunContent availableWidth={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AlertRunContent — the collapsed tail never folds away a critical chip", () => {
  it("keeps BOTH critical chips visible (stacked past the ordinary floor) rather than dropping the second", () => {
    // Famine + Strike (both critical) + 2 important categories = 4 chips, 2 critical. Chosen so the
    // correct wiring (criticalCount: 2) has to reach for the critical-stack step to keep both, while
    // a wiring bug that under-counts the critical tier (e.g. criticalCount: 0 or 1) would instead
    // satisfy this width by dropping Strike into the tail at the ordinary floor — a DIFFERENT chip
    // set, not just a different count, so this doesn't coincide with the broken wiring's own output.
    const width = widthFor(1, OVERLAP_FLOOR) + PLUS_N_WIDTH + 20; // 120: fits 1 at the floor, not 2
    expect(widthFor(2, CRITICAL_STACK_OVERLAP) + PLUS_N_WIDTH).toBeLessThanOrEqual(width);
    expect(widthFor(2, OVERLAP_FLOOR) + PLUS_N_WIDTH).toBeGreaterThan(width);

    alertsData = {
      categories: [
        scoped("famine", 5),
        scoped("strike", 4),
        scoped("deprived_worlds", 3),
        scoped("unrest_rising", 2),
      ],
    };
    render(<AlertRunContent availableWidth={width} />);

    expectButtonNamesInOrder([
      "Famine, 5 of 253 developed systems",
      "Strike, 4 of 253 developed systems",
    ]);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});

describe("AlertRunContent — only the chips are interactive; nothing else in the run takes a click", () => {
  it("renders exactly one button per visible chip and nothing else interactive", () => {
    // jsdom has no CSS cascade or hit-testing, so the `pointer-events-none` container /
    // `pointer-events-auto` chip idiom (the same one map-right-rail.tsx already uses) can't be
    // exercised as an actual click-through here — that part is a visual check. What IS checkable
    // in jsdom is the accessibility tree: the only interactive elements the run contributes are its
    // chip buttons, so there is nothing else in the run's empty space a click could land on.
    alertsData = {
      categories: [scoped("famine", 1), scoped("strike", 1), scoped("deprived_worlds", 1)],
    };
    const { container } = render(<AlertRunContent availableWidth={500} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(container.querySelectorAll("a, [role='link'], [tabindex]:not(button)")).toHaveLength(0);
  });
});

describe("AlertRunContent — hysteresis: a chip survives two zero cycles, then clears on the third", () => {
  it("stays visible through two consecutive zero-count cycles and clears on the third", () => {
    // Cycle 0: Famine has instances — shows immediately (no grace needed to appear).
    transport.currentTick = 1; // floor(1/CYCLE_LENGTH) = 0 → useCycleBoundary anchors here, cycle 0
    alertsData = { categories: [scoped("famine", 3)] };
    const { rerender } = render(<AlertRunContent availableWidth={500} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Famine, 3 of 253 developed systems");

    // Cycle 1: count drops to 0 — first zero cycle, still inside the grace window.
    act(() => {
      transport.currentTick = CYCLE_LENGTH;
    });
    alertsData = { categories: [scoped("famine", 0)] };
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Famine, 0 of 253 developed systems");

    // Cycle 2: still zero — second consecutive zero cycle, still inside the grace window.
    act(() => {
      transport.currentTick = CYCLE_LENGTH * 2;
    });
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Famine, 0 of 253 developed systems");

    // Cycle 3: a third consecutive zero cycle — past the two-cycle grace window, the chip clears.
    act(() => {
      transport.currentTick = CYCLE_LENGTH * 3;
    });
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a count that recovers mid-grace is shown live, not a stale remembered number", () => {
    transport.currentTick = 1;
    alertsData = { categories: [scoped("famine", 3)] };
    const { rerender } = render(<AlertRunContent availableWidth={500} />);

    act(() => {
      transport.currentTick = CYCLE_LENGTH;
    });
    alertsData = { categories: [scoped("famine", 0)] };
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Famine, 0 of 253 developed systems");

    // Recovers within the grace window — the chip never disappeared, so this is just its live data.
    act(() => {
      transport.currentTick = CYCLE_LENGTH * 2;
    });
    alertsData = { categories: [scoped("famine", 7)] };
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Famine, 7 of 253 developed systems");
  });
});
