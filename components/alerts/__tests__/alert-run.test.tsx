import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertRunContent } from "@/components/alerts/alert-run";
import {
  CHIP_WIDTH,
  SPACED_GAP,
  OVERLAP_FLOOR,
  CRITICAL_STACK_OVERLAP,
  PLUS_N_WIDTH,
  SETTINGS_WIDTH,
} from "@/lib/utils/alert-packing";
import type { AlertData, SystemScopedAlertCategory } from "@/lib/types/api";
import type { AtlasData } from "@/lib/types/game";

// AlertRunContent is the half of the run with no DOM measurement anywhere in it or below it — see
// its own docstring. Every test here renders it directly with a literal `availableWidth`; none of
// them render `AlertRun` itself (the measuring wrapper), which needs a real `ResizeObserver` jsdom
// doesn't implement, and would render an empty run at width 0 in every test that tried — the exact
// vacuity AGENTS.md's testing section warns about.

let alertsData: AlertData;
vi.mock("@/lib/hooks/use-alerts", () => ({
  useAlerts: () => alertsData,
}));

// Only reached once a chip is actually clicked open: `ActiveAlertFlyout`
// (components/alerts/alert-run.tsx) is the one place this file's own render tree touches
// `useSystemFocus()`/`useRouter()`, and it mounts only for the open category. None of the tests
// above this point ever click a chip, so these mocks change nothing for them — they exist for the
// "only one flyout open" describe block below.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 0, seed: 1 },
  regions: [],
  systems: [],
  connections: [],
  factions: [],
  player: null,
};
vi.mock("@/lib/hooks/use-atlas", () => ({
  useAtlas: () => ({ atlas: ATLAS }),
}));

function scoped(
  id: SystemScopedAlertCategory["id"],
  count: number,
  denominator = 253,
): SystemScopedAlertCategory {
  return { id, unit: "developed_systems", count, denominator, instances: [] };
}

// `useAlertCategories`' own storage key (lib/hooks/use-alert-categories.ts) — inlined rather than
// imported, the same black-box convention `use-tracker-sections.test.tsx` uses for its own key, so
// these tests exercise the real round trip rather than a mocked hook.
const ALERT_CATEGORIES_STORAGE_KEY = "stellarTrader:alertCategories";

/** The settings control's own accessible name (`alert-run.tsx`'s trailing gear button) — every test
 *  below that renders at least one live chip also renders this, since it appends unconditionally
 *  once the run has anything to show. */
const ALERT_SETTINGS_NAME = "Alert settings";

beforeEach(() => {
  alertsData = { categories: [] };
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

/** How much space `n` chips need at a given packing gap — the same algebra `packRun` itself uses,
 *  so a test can compute an exact boundary instead of guessing a width that's "probably enough". */
function widthFor(n: number, gap: number): number {
  return n <= 0 ? 0 : n * CHIP_WIDTH + Math.max(0, n - 1) * gap;
}

/** The same reservation `packRun` adds to every check for the always-rendered settings control
 *  (`lib/utils/alert-packing.ts`'s own unexported `SETTINGS_RESERVE`), re-derived here from the two
 *  constants this file already imports rather than duplicated as a literal. */
const SETTINGS_RESERVE = SETTINGS_WIDTH + SPACED_GAP;

/** Asserts the rendered chip buttons carry `names`, front to back, PLUS the trailing settings
 *  control every non-empty run now appends — order AND content in one check, via jest-dom's own
 *  accessible-name matcher rather than a hand-rolled computation. */
function expectButtonNamesInOrder(names: string[]): void {
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(names.length + 1);
  names.forEach((name, i) => expect(buttons[i]).toHaveAccessibleName(name));
  expect(buttons[buttons.length - 1]).toHaveAccessibleName(ALERT_SETTINGS_NAME);
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
    // The settings control still renders — it is unconditional — so this checks for the absence of
    // a category chip specifically, not for zero buttons overall.
    expect(screen.queryByRole("button", { name: /^Famine/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
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

describe("AlertRunContent — below the width that fits the critical tier plus a +N, the run renders no chips", () => {
  it("renders no chips and no collapsed tail at a width that fits nothing, but keeps the settings control", () => {
    alertsData = { categories: [scoped("famine", 4)] };
    render(<AlertRunContent availableWidth={1} />);
    expect(screen.queryByRole("button", { name: /^Famine/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });

  it("does not render an empty container — the settings control survives even when no chip fits", () => {
    // Distinct from the assertion above: an empty-but-present wrapper element would also show no
    // Famine button and no "+" text, so that test alone can't tell "no chips, but the settings
    // control survives" from "the whole run vanished". The settings control is the run's only entry
    // point back to its own category checkboxes (docs/build-plans/alert-bar.md → "Placement and
    // behaviour"), so it renders regardless of how many chips fit — this checks the container itself
    // carries that control, not nothing.
    alertsData = { categories: [scoped("famine", 4)] };
    const { container } = render(<AlertRunContent availableWidth={1} />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the collapsed tail never folds away a critical chip", () => {
  it("keeps BOTH critical chips visible (stacked past the ordinary floor) rather than dropping the second", () => {
    // Famine + Strike (both critical) + 2 important categories = 4 chips, 2 critical. Chosen so the
    // correct wiring (criticalCount: 2) has to reach for the critical-stack step to keep both, while
    // a wiring bug that under-counts the critical tier (e.g. criticalCount: 0 or 1) would instead
    // satisfy this width by dropping Strike into the tail at the ordinary floor — a DIFFERENT chip
    // set, not just a different count, so this doesn't coincide with the broken wiring's own output.
    // +20 headroom, plus the settings control's own reservation (it renders unconditionally,
    // alongside these chips, so packRun's checks reserve room for it too).
    const width = widthFor(1, OVERLAP_FLOOR) + PLUS_N_WIDTH + SETTINGS_RESERVE + 20;
    expect(widthFor(2, CRITICAL_STACK_OVERLAP) + PLUS_N_WIDTH + SETTINGS_RESERVE).toBeLessThanOrEqual(width);
    expect(widthFor(2, OVERLAP_FLOOR) + PLUS_N_WIDTH + SETTINGS_RESERVE).toBeGreaterThan(width);

    alertsData = {
      // All four default ON — `overcrowded` stands in for a second important category rather than
      // `unrest_rising`, which defaults OFF and would otherwise leave only 3 shown.
      categories: [
        scoped("famine", 5),
        scoped("strike", 4),
        scoped("deprived_worlds", 3),
        scoped("overcrowded", 2),
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

describe("AlertRunContent — only the chips and the settings control are interactive; nothing else in the run takes a click", () => {
  it("renders one button per visible chip plus the trailing settings control and nothing else interactive", () => {
    // jsdom has no CSS cascade or hit-testing, so the `pointer-events-none` container /
    // `pointer-events-auto` chip idiom (the same one map-right-rail.tsx already uses) can't be
    // exercised as an actual click-through here — that part is a visual check. What IS checkable
    // in jsdom is the accessibility tree: the only interactive elements the run contributes are its
    // chip buttons plus the settings control, so there is nothing else in the run's empty space a
    // click could land on.
    alertsData = {
      categories: [scoped("famine", 1), scoped("strike", 1), scoped("deprived_worlds", 1)],
    };
    const { container } = render(<AlertRunContent availableWidth={500} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(container.querySelectorAll("a, [role='link'], [tabindex]:not(button)")).toHaveLength(0);
  });
});

describe("AlertRunContent — a category's chip tracks its count directly, no grace window", () => {
  it("clears immediately, the same render its count drops to zero — no stale chip left behind", () => {
    alertsData = { categories: [scoped("famine", 3)] };
    const { rerender } = render(<AlertRunContent availableWidth={500} />);
    // Scoped by name — the trailing settings control is also rendered once Famine's chip is live,
    // so a plain `getByRole("button")` (singular) would throw on more than one match.
    expect(screen.getByRole("button", { name: /^Famine/ })).toHaveAccessibleName(
      "Famine, 3 of 253 developed systems",
    );

    alertsData = { categories: [scoped("famine", 0)] };
    rerender(<AlertRunContent availableWidth={500} />);
    expect(screen.queryByRole("button", { name: /^Famine/ })).not.toBeInTheDocument();
    // The settings control is unconditional, so it is the one button left once Famine clears.
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});

describe("AlertRunContent — only one flyout is open at a time", () => {
  it("opening a second chip's flyout closes the first, rather than stacking both", async () => {
    const user = userEvent.setup();
    alertsData = { categories: [scoped("famine", 3), scoped("strike", 2)] };
    render(<AlertRunContent availableWidth={widthFor(2, SPACED_GAP) + 50} />);

    await user.click(screen.getByRole("button", { name: /Famine/ }));
    expect(screen.getByRole("dialog", { name: "Famine alerts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Strike/ }));
    expect(screen.queryByRole("dialog", { name: "Famine alerts" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Strike alerts" })).toBeInTheDocument();
  });
});

describe("AlertRunContent — a default-off category starts filtered out of the run on a first visit", () => {
  it("renders no chip for Unrest rising even though it has live instances, with empty storage", async () => {
    alertsData = { categories: [scoped("famine", 1), scoped("unrest_rising", 5)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Unrest rising/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the settings control opens the panel and its checkbox filters the run live", () => {
  it("opening settings and unchecking Deprived worlds hides its chip immediately, live in the run", async () => {
    const user = userEvent.setup();
    alertsData = { categories: [scoped("famine", 1), scoped("deprived_worlds", 4)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: /Deprived worlds/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ALERT_SETTINGS_NAME }));
    const checkbox = screen.getByRole("checkbox", { name: "Deprived worlds" });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(screen.queryByRole("button", { name: /Deprived worlds/ })).not.toBeInTheDocument();
    // The critical chip is unaffected, and the settings panel is still open — toggling a category
    // does not close it (components/alerts/alert-settings.tsx's own contract).
    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Alert settings" })).toBeInTheDocument();
  });

  it("checking a default-off category on shows its chip live", async () => {
    const user = userEvent.setup();
    alertsData = { categories: [scoped("famine", 1), scoped("unrest_rising", 3)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Unrest rising/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ALERT_SETTINGS_NAME }));
    await user.click(screen.getByRole("checkbox", { name: "Unrest rising" }));

    expect(screen.getByRole("button", { name: /Unrest rising/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the settings checkbox cannot override the automation gate", () => {
  it("Build opportunity stays absent with its checkbox stored ON but a count of 0", async () => {
    // A count of 0 is exactly what `lib/services/alerts.ts` emits while build automation is on — the
    // service self-gates independently of any client setting. This does NOT mock a non-zero count
    // for an automated category (a state the app never reaches); it proves the checkbox has no power
    // over a category whose count never went above zero, which is the only lever the checkbox has.
    window.localStorage.setItem(
      ALERT_CATEGORIES_STORAGE_KEY,
      JSON.stringify({ build_opportunity: true }),
    );
    alertsData = { categories: [scoped("famine", 1), scoped("build_opportunity", 0)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Build opportunity/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — a critical category cannot be hidden even by a corrupted stored value", () => {
  it("still renders Famine's chip when localStorage carries famine: false", async () => {
    window.localStorage.setItem(ALERT_CATEGORIES_STORAGE_KEY, JSON.stringify({ famine: false }));
    alertsData = { categories: [scoped("famine", 2)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the settings control is reachable even when every hideable category is off and nothing critical is firing", () => {
  it("still renders the settings control with an empty run — the lockout this change fixes", async () => {
    // Before this change, AlertRunChips returned null the moment packRun had zero chips to place —
    // reachable in exactly this state, a healthy galaxy (no critical category firing) with every
    // hideable category the player owns switched off. That took the run's own settings trigger down
    // with it: the only way back into the categories that hid everything was clearing localStorage by
    // hand (docs/build-plans/alert-bar.md → "Placement and behaviour"). Deprived worlds stands in for
    // "a hideable category with a live, nonzero count" — proving the control survives even when there
    // IS something to show and a stored preference is what's hiding it, not just an empty galaxy.
    window.localStorage.setItem(
      ALERT_CATEGORIES_STORAGE_KEY,
      JSON.stringify({ deprived_worlds: false }),
    );
    alertsData = { categories: [scoped("deprived_worlds", 3)] };
    render(<AlertRunContent availableWidth={500} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Deprived worlds/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});
