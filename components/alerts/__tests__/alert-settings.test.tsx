import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { DEFAULT_ALERT_CATEGORIES, type AlertCategorySettings } from "@/lib/hooks/use-alert-categories";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { ALERT_CATEGORY_IDS, type AlertCategoryId } from "@/lib/types/alerts";

// AlertSettings is pure props-in: it never calls `useAlertCategories()` itself (mirrors
// `TrackerSettingsProps`'s own `sections`/`onChangeSection` split), so every test here renders it
// directly with a `categories` record and spy/stateful callbacks — no localStorage, no router, no
// QueryBoundary. The boundary/hook-level tests (malformed storage, per-key merge, the automation-
// independent no-op on a critical id) live in `lib/hooks/__tests__/use-alert-categories.test.tsx`.
//
// AlertSettings's own return is now a `PopoverContent` (`components/ui/popover.tsx`), which needs a
// `Popover` ancestor and starts closed — `renderOpenPanel` below wraps it in a real `Popover`/
// `PopoverTrigger` and clicks the trigger, the same way `AlertRunChips` actually mounts it. Escape
// closing it and returning focus to its trigger is `Popover`'s own guarantee now (proven generically
// in `components/ui/__tests__/popover.test.tsx`), not this file's to pin.

const CRITICAL_LABELS = ["Famine", "Strike", "Maintenance unfunded", "Crisis"];

async function renderPanel(categories: AlertCategorySettings = DEFAULT_ALERT_CATEGORIES) {
  const user = userEvent.setup();
  const onChangeCategory = vi.fn();
  render(
    <Popover>
      <PopoverTrigger>
        <button type="button">Open settings</button>
      </PopoverTrigger>
      <AlertSettings categories={categories} onChangeCategory={onChangeCategory} />
    </Popover>,
  );
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  return { user, onChangeCategory };
}

describe("AlertSettings — critical categories render no control at all", () => {
  it("renders no checkbox for any of the four critical categories, while still naming them", async () => {
    await renderPanel();

    for (const label of CRITICAL_LABELS) {
      // Not a disabled checkbox — a checkbox with this name must not exist in the accessibility
      // tree at all, disabled or otherwise. `queryByRole` with a `checked` filter would still find
      // a disabled one; asserting plain absence is what actually pins "no control".
      expect(screen.queryByRole("checkbox", { name: label })).not.toBeInTheDocument();
      // The category is still named on the panel — this isn't a missing row, just a missing control.
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders a checkbox for every hideable category — the absence above is category-specific, not global", async () => {
    await renderPanel();
    // 16 categories total, 4 critical (no control) → 12 checkboxes.
    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
  });
});

describe("AlertSettings — every category has a row, in each tier's own authored order", () => {
  /** The rows this panel must show, tier by tier, spelled out rather than derived off the registry
   *  the panel itself reads — a derived expectation would agree with any ordering the component
   *  produced, including none. */
  const EXPECTED_ROWS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["Critical", ["Famine", "Strike", "Maintenance unfunded", "Crisis"]],
    [
      "Important",
      [
        "Deprived worlds",
        "Unrest rising",
        "Survival stock falling",
        "Demand unservable",
        "Overcrowded",
        "No housing headroom",
        "Build blocked",
        "Industry idle",
        "Disruption",
      ],
    ],
    ["Opportunities", ["Build opportunity", "Colony opportunity", "Windfall"]],
  ];

  it("accounts for every id in the registry — a category the panel drops has an unreachable setting", () => {
    // The point of the ordering coming off `ALERT_CATEGORIES` rather than a second list beside it:
    // a seventeenth category cannot ship with no checkbox at all. This fails the moment the union
    // grows past what the rows below name.
    const named = EXPECTED_ROWS.flatMap(([, labels]) => labels);
    expect(named).toHaveLength(ALERT_CATEGORY_IDS.length);
    expect([...named].sort()).toEqual(ALERT_CATEGORY_IDS.map((id) => ALERT_CATEGORIES[id].label).sort());
  });

  it("renders each tier's rows in the registry's authored order within that tier", async () => {
    await renderPanel();

    for (const [heading, labels] of EXPECTED_ROWS) {
      const group = screen.getByRole("group", { name: `${heading} alert categories` });
      const text = group.textContent ?? "";
      const positions = labels.map((label) => text.indexOf(label));
      // Every row is present in this tier's group...
      expect(positions.every((position) => position >= 0)).toBe(true);
      // ...and in this order, front to back.
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("AlertSettings — the three spec-named default-off categories render unchecked", () => {
  it("renders Unrest rising, Build blocked and Industry idle unchecked given DEFAULT_ALERT_CATEGORIES", async () => {
    await renderPanel();

    expect(screen.getByRole("checkbox", { name: "Unrest rising" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Build blocked" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Industry idle" })).not.toBeChecked();
    // A default-ON hideable category, for contrast — the absence above is a real distinction, not
    // every checkbox rendering unchecked regardless of its value.
    expect(screen.getByRole("checkbox", { name: "Deprived worlds" })).toBeChecked();
  });
});

describe("AlertSettings — toggling a category calls back with the right id", () => {
  it("clicking an unchecked category's checkbox reports it turning on", async () => {
    const { user, onChangeCategory } = await renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Unrest rising" }));

    expect(onChangeCategory).toHaveBeenCalledExactlyOnceWith("unrest_rising" satisfies AlertCategoryId, true);
  });

  it("clicking a checked category's checkbox reports it turning off", async () => {
    const { user, onChangeCategory } = await renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Deprived worlds" }));

    expect(onChangeCategory).toHaveBeenCalledExactlyOnceWith("deprived_worlds" satisfies AlertCategoryId, false);
  });
});

/** A stateful harness — real `categories` state fed back through `onChangeCategory`, so the panel's
 *  own checked state visibly updates the way it does wired to the real hook, not just the spy call
 *  arguments. */
function SettingsHarness() {
  const [categories, setCategories] = useState<AlertCategorySettings>(DEFAULT_ALERT_CATEGORIES);
  function onChangeCategory(id: AlertCategoryId, on: boolean) {
    setCategories((prev) => ({ ...prev, [id]: on }));
  }
  return (
    <Popover>
      <PopoverTrigger>
        <button type="button">Open settings</button>
      </PopoverTrigger>
      <AlertSettings categories={categories} onChangeCategory={onChangeCategory} />
    </Popover>
  );
}

describe("AlertSettings — a full toggle round trip stays open and reflects the new state", () => {
  it("checking Unrest rising flips it to checked while the panel remains mounted", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const checkbox = screen.getByRole("checkbox", { name: "Unrest rising" });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    // The settings panel must not close when a checkbox is toggled — trying combinations one after
    // another would be unusable if every click closed it. Checked structurally (the dialog and its
    // checkbox are both still in the document, still reflecting the new state) rather than via an
    // `onClose` spy: this component no longer has an `onClose` prop to call at all — closing is
    // `Popover`'s own job now, and nothing here calls into it on a checkbox click.
    expect(screen.getByRole("checkbox", { name: "Unrest rising" })).toBeChecked();
    expect(screen.getByRole("dialog", { name: "Alert settings" })).toBeInTheDocument();
  });
});
