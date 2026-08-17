import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertRunContent } from "@/components/alerts/alert-run";
import { layoutRun, type PlacedItem, type RunChip } from "@/lib/utils/alert-packing";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertCategory, AlertData, SystemScopedAlertCategory } from "@/lib/types/api";
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

// One real system, because `useSystemFocus()` resolves a row's systemId against the atlas's own
// coordinates and silently no-ops on an id it cannot find — an empty atlas would make the row-click
// test pass with the navigation never happening.
const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 1, seed: 1 },
  regions: [],
  systems: [
    {
      id: "sys-1",
      x: 12,
      y: 7,
      regionId: "region-1",
      factionId: null,
      economyType: "agricultural",
      isGateway: false,
      developed: true,
      sunClass: "yellow",
    },
  ],
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

/** The settings control's own accessible name (`alert-run.tsx`'s leading gear button) — every test
 *  below renders it, since it mounts unconditionally whatever the chip count. */
const ALERT_SETTINGS_NAME = "Alert settings";

beforeEach(() => {
  alertsData = { categories: [] };
  push.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

/** A width comfortably past anything these categories need, for the tests that are about what the
 *  run renders rather than about how it packs. */
const ROOMY = 500;

/** The same ordered tier-and-count sequence `AlertRunChips` builds from the live categories — the
 *  layout's own input, assembled here from the very categories a test feeds the component so the two
 *  cannot describe different runs. */
function runChipsFor(categories: readonly AlertCategory[]): RunChip[] {
  return categories.map((category) => ({
    tier: ALERT_CATEGORIES[category.id].tier,
    count: category.count,
  }));
}

/**
 * The narrowest `availableWidth` at which the layout lays those categories out the way `holds`
 * describes — asked of `layoutRun` itself rather than computed from a copy of its width arithmetic.
 * The offsets are the node tests' business (`lib/utils/__tests__/alert-packing.test.ts`); what a
 * width is for HERE is putting the component into the packing state whose DOM this file asserts.
 */
function widthWhere(
  categories: readonly AlertCategory[],
  holds: (items: readonly PlacedItem<RunChip>[]) => boolean,
): number {
  const chips = runChipsFor(categories);
  for (let width = 0; width <= 1400; width++) {
    if (holds(layoutRun(chips, width).items)) return width;
  }
  throw new Error("no width in 0..1400 lays this run out that way");
}

function drawnChips(items: readonly PlacedItem<RunChip>[]): number {
  return items.filter((item) => item.kind === "chip").length;
}

function foldedIntoTail(items: readonly PlacedItem<RunChip>[]): number {
  return items.reduce((total, item) => (item.kind === "tail" ? total + item.collapsed : total), 0);
}

/** Asserts the run's buttons in document order: the leading settings control, then the chips
 *  carrying `names` front to back — order AND content in one check, via jest-dom's own
 *  accessible-name matcher rather than a hand-rolled computation. */
function expectButtonNamesInOrder(names: string[]): void {
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(names.length + 1);
  expect(buttons[0]).toHaveAccessibleName(ALERT_SETTINGS_NAME);
  names.forEach((name, i) => expect(buttons[i + 1]).toHaveAccessibleName(name));
}

describe("AlertRunContent — renders the live categories, in the order useAlerts already sorted them", () => {
  it("renders one chip per nonzero category with its accessible name, front to back", () => {
    alertsData = {
      categories: [scoped("famine", 3), scoped("strike", 2), scoped("deprived_worlds", 1)],
    };
    render(<AlertRunContent availableWidth={ROOMY} />);

    expectButtonNamesInOrder([
      "Famine, 3 of 253 developed systems",
      "Strike, 2 of 253 developed systems",
      "Deprived worlds, 1 of 253 developed systems",
    ]);
  });

  it("a category with a zero count and no prior history renders no chip at all", () => {
    alertsData = { categories: [scoped("famine", 0)] };
    render(<AlertRunContent availableWidth={ROOMY} />);
    // The settings control still renders — it is unconditional — so this checks for the absence of
    // a category chip specifically, not for zero buttons overall.
    expect(screen.queryByRole("button", { name: /^Famine/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

/** Whether `later` comes after `earlier` in document order — the DOM's own comparison, not an index
 *  into a query result, so it holds whatever else the run renders between the two. */
function follows(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("AlertRunContent — the settings control leads the run", () => {
  it("renders the settings control before every chip in document order", () => {
    // The run is a left-anchored flex row, so document order IS left-to-right order: the control
    // sitting first is what makes its position independent of the chip count, and so what stops
    // turning a category on from its own popover pushing that popover rightward mid-click.
    alertsData = {
      categories: [scoped("famine", 3), scoped("strike", 2), scoped("deprived_worlds", 1)],
    };
    render(<AlertRunContent availableWidth={ROOMY} />);

    const settings = screen.getByRole("button", { name: ALERT_SETTINGS_NAME });
    for (const name of [/^Famine/, /^Strike/, /^Deprived worlds/]) {
      expect(follows(settings, screen.getByRole("button", { name }))).toBe(true);
    }
  });

  it("still leads the run when no chip fits and only the collapsed tail renders", () => {
    // The other branch the control's placement has to cover: the layout draws no chip at all and
    // folds every category away, so the "+N" tail — not a chip — is what sits immediately after the
    // control.
    const categories = [scoped("deprived_worlds", 4), scoped("overcrowded", 2)];
    alertsData = { categories };
    const width = widthWhere(categories, (items) => drawnChips(items) === 0 && foldedIntoTail(items) === 2);
    render(<AlertRunContent availableWidth={width} />);

    const settings = screen.getByRole("button", { name: ALERT_SETTINGS_NAME });
    expect(follows(settings, screen.getByText("+2"))).toBe(true);
  });
});

describe("AlertRunContent — chip order does not change when a count changes", () => {
  it("keeps the same front-to-back order across a re-render with different counts", () => {
    alertsData = { categories: [scoped("famine", 2), scoped("strike", 9)] };
    const { rerender } = render(<AlertRunContent availableWidth={ROOMY} />);
    expectButtonNamesInOrder(["Famine, 2 of 253 developed systems", "Strike, 9 of 253 developed systems"]);

    // Strike's count now dwarfs Famine's — if anything ever sorted by count, this is the render
    // that would move it first.
    alertsData = { categories: [scoped("famine", 25), scoped("strike", 1)] };
    rerender(<AlertRunContent availableWidth={ROOMY} />);
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
    // point back to its own category checkboxes (docs/active/gameplay/alert-bar.md → "Placement and
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
    // Famine + Strike (both critical) + 2 important categories = 4 chips, a critical prefix of 2.
    // The narrowest width that draws exactly two chips is the critical-stack step, which is the only
    // way to keep both: a wiring bug handing the layout a shorter critical prefix would satisfy the
    // same width by dropping Strike into the tail — a DIFFERENT chip set, not just a different
    // count, so this cannot coincide with the broken wiring's own output.
    const categories = [
      // All four default ON — `overcrowded` stands in for a second important category rather than
      // `unrest_rising`, which defaults OFF and would otherwise leave only 3 shown.
      scoped("famine", 5),
      scoped("strike", 4),
      scoped("deprived_worlds", 3),
      scoped("overcrowded", 2),
    ];
    alertsData = { categories };
    const width = widthWhere(categories, (items) => drawnChips(items) === 2);
    render(<AlertRunContent availableWidth={width} />);

    expectButtonNamesInOrder([
      "Famine, 5 of 253 developed systems",
      "Strike, 4 of 253 developed systems",
    ]);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});

describe("AlertRunContent — the collapsed tail names every folded category, even when no chip at all fits", () => {
  it("renders the +N tail with nothing critical firing and no room for a chip", () => {
    // The ordinary narrow-viewport case, not a corner: with no critical category live, the layout
    // has no chip it is obliged to keep, so it draws none and folds every category into the tail.
    // Both categories default ON and both are hideable — no critical category anywhere in the run.
    const categories = [scoped("deprived_worlds", 4), scoped("overcrowded", 2)];
    alertsData = { categories };
    const width = widthWhere(categories, (items) => drawnChips(items) === 0 && foldedIntoTail(items) === 2);
    render(<AlertRunContent availableWidth={width} />);

    expect(screen.getByText("+2")).toBeInTheDocument();
    // No chip fit, so the settings control is the only button — the tail is a plain count, not a
    // control (it names several categories at once, so it has no one flyout to open).
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});

describe("AlertRunContent — a flyout row click navigates to the row's own destination", () => {
  it("flies the map to the instance's system and opens the category's destination tab", async () => {
    const user = userEvent.setup();
    // Famine's authored destination is the system's Population tab (lib/constants/alerts.ts), so
    // this exercises the real `resolveAlertTarget` → `useSystemFocus` wiring rather than a spy
    // standing in for it — the row has to carry a systemId the atlas above actually knows.
    alertsData = {
      categories: [
        {
          id: "famine",
          unit: "developed_systems",
          count: 1,
          denominator: 253,
          instances: [{ systemId: "sys-1", name: "Vega", measure: "-3.2 pop/cycle", sortKey: -3.2 }],
        },
      ],
    };
    render(<AlertRunContent availableWidth={ROOMY} />);

    await user.click(screen.getByRole("button", { name: /^Famine/ }));
    await user.click(screen.getByRole("button", { name: /Vega/ }));

    // `loc` is a monotonic nonce shared by every `useSystemFocus()` caller, so its exact value is
    // whatever this process has already handed out — the assertion is on everything else.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/system\/sys-1\/population\?focus=12,7&loc=\d+$/));
  });
});

describe("AlertRunContent — only the chips and the settings control are interactive; nothing else in the run takes a click", () => {
  it("renders one button per visible chip plus the leading settings control and nothing else interactive", () => {
    // jsdom has no CSS cascade or hit-testing, so the `pointer-events-none` container /
    // `pointer-events-auto` chip idiom (the same one map-right-rail.tsx already uses) can't be
    // exercised as an actual click-through here — that part is a visual check. What IS checkable
    // in jsdom is the accessibility tree: the only interactive elements the run contributes are its
    // chip buttons plus the settings control, so there is nothing else in the run's empty space a
    // click could land on.
    alertsData = {
      categories: [scoped("famine", 1), scoped("strike", 1), scoped("deprived_worlds", 1)],
    };
    const { container } = render(<AlertRunContent availableWidth={ROOMY} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(container.querySelectorAll("a, [role='link'], [tabindex]:not(button)")).toHaveLength(0);
  });
});

describe("AlertRunContent — a category's chip tracks its count directly, no grace window", () => {
  it("clears immediately, the same render its count drops to zero — no stale chip left behind", () => {
    alertsData = { categories: [scoped("famine", 3)] };
    const { rerender } = render(<AlertRunContent availableWidth={ROOMY} />);
    // Scoped by name — the settings control is rendered alongside Famine's chip,
    // so a plain `getByRole("button")` (singular) would throw on more than one match.
    expect(screen.getByRole("button", { name: /^Famine/ })).toHaveAccessibleName(
      "Famine, 3 of 253 developed systems",
    );

    alertsData = { categories: [scoped("famine", 0)] };
    rerender(<AlertRunContent availableWidth={ROOMY} />);
    expect(screen.queryByRole("button", { name: /^Famine/ })).not.toBeInTheDocument();
    // The settings control is unconditional, so it is the one button left once Famine clears.
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});

describe("AlertRunContent — only one flyout is open at a time", () => {
  it("opening a second chip's flyout closes the first, rather than stacking both", async () => {
    const user = userEvent.setup();
    alertsData = { categories: [scoped("famine", 3), scoped("strike", 2)] };
    render(<AlertRunContent availableWidth={ROOMY} />);

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
    render(<AlertRunContent availableWidth={ROOMY} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Unrest rising/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the settings control opens the panel and its checkbox filters the run live", () => {
  it("opening settings and unchecking Deprived worlds hides its chip immediately, live in the run", async () => {
    const user = userEvent.setup();
    alertsData = { categories: [scoped("famine", 1), scoped("deprived_worlds", 4)] };
    render(<AlertRunContent availableWidth={ROOMY} />);
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
    render(<AlertRunContent availableWidth={ROOMY} />);
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
    render(<AlertRunContent availableWidth={ROOMY} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Build opportunity/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — a critical category cannot be hidden even by a corrupted stored value", () => {
  it("still renders Famine's chip when localStorage carries famine: false", async () => {
    window.localStorage.setItem(ALERT_CATEGORIES_STORAGE_KEY, JSON.stringify({ famine: false }));
    alertsData = { categories: [scoped("famine", 2)] };
    render(<AlertRunContent availableWidth={ROOMY} />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: /^Famine/ })).toBeInTheDocument();
  });
});

describe("AlertRunContent — the settings control is reachable even when every hideable category is off and nothing critical is firing", () => {
  it("still renders the settings control with an empty run", async () => {
    // The lockout state: a healthy galaxy (no critical category firing) with every hideable category
    // the player owns switched off. A run that rendered nothing here would take its own settings
    // trigger down with it, leaving no way back into the categories that hid everything short of
    // clearing localStorage by hand (docs/active/gameplay/alert-bar.md → "Placement and behaviour").
    // Deprived worlds stands in for "a hideable category with a live, nonzero count" — the control
    // has to survive even when there IS something to show and a stored preference is what's hiding
    // it, not just an empty galaxy.
    window.localStorage.setItem(
      ALERT_CATEGORIES_STORAGE_KEY,
      JSON.stringify({ deprived_worlds: false }),
    );
    alertsData = { categories: [scoped("deprived_worlds", 3)] };
    render(<AlertRunContent availableWidth={ROOMY} />);
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Deprived worlds/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ALERT_SETTINGS_NAME })).toBeInTheDocument();
  });
});
