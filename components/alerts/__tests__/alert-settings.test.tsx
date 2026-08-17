import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { DEFAULT_ALERT_CATEGORIES, type AlertCategorySettings } from "@/lib/hooks/use-alert-categories";
import type { AlertCategoryId } from "@/lib/types/alerts";

// AlertSettings is pure props-in: it never calls `useAlertCategories()` itself (mirrors
// `TrackerSettingsProps`'s own `sections`/`onChangeSection` split), so every test here renders it
// directly with a `categories` record and spy/stateful callbacks — no localStorage, no router, no
// QueryBoundary. The boundary/hook-level tests (malformed storage, per-key merge, the automation-
// independent no-op on a critical id) live in `lib/hooks/__tests__/use-alert-categories.test.tsx`.

const CRITICAL_LABELS = ["Famine", "Strike", "Maintenance unfunded", "Crisis"];

function renderPanel(categories: AlertCategorySettings = DEFAULT_ALERT_CATEGORIES) {
  const onChangeCategory = vi.fn();
  const onClose = vi.fn();
  render(<AlertSettings categories={categories} onChangeCategory={onChangeCategory} onClose={onClose} />);
  return { onChangeCategory, onClose };
}

describe("AlertSettings — critical categories render no control at all", () => {
  it("renders no checkbox for any of the four critical categories, while still naming them", () => {
    renderPanel();

    for (const label of CRITICAL_LABELS) {
      // Not a disabled checkbox — a checkbox with this name must not exist in the accessibility
      // tree at all, disabled or otherwise. `queryByRole` with a `checked` filter would still find
      // a disabled one; asserting plain absence is what actually pins "no control".
      expect(screen.queryByRole("checkbox", { name: label })).not.toBeInTheDocument();
      // The category is still named on the panel — this isn't a missing row, just a missing control.
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders a checkbox for every hideable category — the absence above is category-specific, not global", () => {
    renderPanel();
    // 16 categories total, 4 critical (no control) → 12 checkboxes.
    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
  });
});

describe("AlertSettings — the three spec-named default-off categories render unchecked", () => {
  it("renders Unrest rising, Build blocked and Industry idle unchecked given DEFAULT_ALERT_CATEGORIES", () => {
    renderPanel();

    expect(screen.getByRole("checkbox", { name: "Unrest rising" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Build blocked" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Industry idle" })).not.toBeChecked();
    // A default-ON hideable category, for contrast — the absence above is a real distinction, not
    // every checkbox rendering unchecked regardless of its value.
    expect(screen.getByRole("checkbox", { name: "Deprived worlds" })).toBeChecked();
  });
});

describe("AlertSettings — toggling a category calls back with the right id, never onClose", () => {
  it("clicking an unchecked category's checkbox reports it turning on, and does not close the panel", async () => {
    const user = userEvent.setup();
    const { onChangeCategory, onClose } = renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Unrest rising" }));

    expect(onChangeCategory).toHaveBeenCalledExactlyOnceWith("unrest_rising" satisfies AlertCategoryId, true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking a checked category's checkbox reports it turning off", async () => {
    const user = userEvent.setup();
    const { onChangeCategory, onClose } = renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Deprived worlds" }));

    expect(onChangeCategory).toHaveBeenCalledExactlyOnceWith("deprived_worlds" satisfies AlertCategoryId, false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** A stateful harness — real `categories` state fed back through `onChangeCategory`, so the panel's
 *  own checked state visibly updates the way it does wired to the real hook, not just the spy call
 *  arguments. Mirrors `alert-flyout.test.tsx`'s own `Harness`. */
function SettingsHarness() {
  const [open, setOpen] = useState(true);
  const [categories, setCategories] = useState<AlertCategorySettings>(DEFAULT_ALERT_CATEGORIES);
  function onChangeCategory(id: AlertCategoryId, on: boolean) {
    setCategories((prev) => ({ ...prev, [id]: on }));
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      {open && (
        <AlertSettings categories={categories} onChangeCategory={onChangeCategory} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

describe("AlertSettings — a full toggle round trip stays open and reflects the new state", () => {
  it("checking Unrest rising flips it to checked while the panel remains mounted", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);

    const checkbox = screen.getByRole("checkbox", { name: "Unrest rising" });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(screen.getByRole("checkbox", { name: "Unrest rising" })).toBeChecked();
    expect(screen.getByRole("dialog", { name: "Alert settings" })).toBeInTheDocument();
  });
});

describe("AlertSettings — Escape closes it and returns focus to its own trigger", () => {
  it("pressing Escape unmounts the panel and returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          {open && (
            <AlertSettings
              categories={DEFAULT_ALERT_CATEGORIES}
              onChangeCategory={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open settings" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Alert settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Alert settings" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
