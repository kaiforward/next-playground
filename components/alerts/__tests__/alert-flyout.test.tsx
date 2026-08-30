import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertFlyout,
  resolveAlertTarget,
  alertFooterText,
  type AlertNavigateTarget,
} from "@/components/alerts/alert-flyout";
import type {
  AlertCategory,
  AlertInstance,
  ControlledSystemsAlertCategory,
  FactionAlertCategory,
  SystemScopedAlertCategory,
} from "@/lib/types/api";

// AlertFlyout never fetches and never calls a router or the atlas itself — that lives in
// `ActiveAlertFlyout` (components/alerts/alert-run.tsx), which mounts only once a flyout is open
// and is exercised there, in alert-run.test.tsx's own "only one flyout open" case. Everything here
// renders AlertFlyout directly with spy props, per the same convention alert-chip.test.tsx and
// alert-run.test.tsx already use — accessible roles, names and rendered text, never a class or a
// style.
//
// AlertFlyout's own return is now a `PopoverContent` (`components/ui/popover.tsx`), which requires a
// `Popover` ancestor and starts closed — `renderOpenFlyout` below wraps it in a real `Popover` and
// `PopoverTrigger`, then clicks the trigger, the same way `AlertRunChips` actually mounts it. The
// Escape-closes/focus-returns mechanics that used to be pinned by a bespoke `Harness` in this file are
// gone along with the hand-rolled Escape listener and focus capture they exercised — both are now
// `Popover`'s own guarantees, already proven generically by `components/ui/__tests__/popover.test.tsx`
// ("Escape is the way back out" and the exclusivity/pointer-transit blocks).

function instance(name: string, measure: string, systemId: string | null, sortKey = 0): AlertInstance {
  return { systemId, name, measure, sortKey };
}

const populationCollapse: SystemScopedAlertCategory = {
  id: "population_collapse",
  unit: "developed_systems",
  count: 2,
  denominator: 253,
  instances: [instance("Sunnyvale", "Provision 12%", "sys-a"), instance("Rigel", "Provision 4%", "sys-b")],
};

const colonyOpportunity: ControlledSystemsAlertCategory = {
  id: "colony_opportunity",
  unit: "controlled_systems",
  count: 1,
  denominator: 12,
  instances: [instance("New Haven", "ROI 3.2x", "sys-c")],
};

const maintenanceUnfunded: FactionAlertCategory = {
  id: "maintenance_unfunded",
  unit: "faction",
  count: 1,
  instances: [instance("The Terran Compact", "$1.2M short", null)],
};

function manyInstances(n: number): AlertInstance[] {
  return Array.from({ length: n }, (_, i) => instance(`System ${i}`, `Provision ${i}%`, `sys-${i}`, i));
}

/** Mirrors how `AlertRun` actually mounts a flyout: a real `Popover`/`PopoverTrigger` pair, opened by
 *  a real click rather than rendered pre-opened — `AlertFlyout`'s own return is a `PopoverContent`,
 *  which needs a `Popover` ancestor and starts closed. */
async function renderOpenFlyout(
  category: AlertCategory,
  onNavigate: (target: AlertNavigateTarget) => void = vi.fn(),
) {
  const user = userEvent.setup();
  render(
    <Popover>
      <PopoverTrigger>
        <button type="button">Open {category.id}</button>
      </PopoverTrigger>
      <AlertFlyout category={category} onNavigate={onNavigate} />
    </Popover>,
  );
  await user.click(screen.getByRole("button", { name: `Open ${category.id}` }));
  return { user };
}

describe("resolveAlertTarget — the row's destination, resolved off the category and the instance", () => {
  it("a system-scoped category resolves to its authored tab, using the instance's own systemId", () => {
    expect(resolveAlertTarget(populationCollapse, populationCollapse.instances[0])).toEqual({
      kind: "system",
      systemId: "sys-a",
      tab: "population",
    });
  });

  it("Maintenance unfunded resolves to the player faction's Overview regardless of the instance's systemId", () => {
    expect(resolveAlertTarget(maintenanceUnfunded, maintenanceUnfunded.instances[0])).toEqual({
      kind: "faction",
      tab: "",
    });
  });

});

describe("alertFooterText — states the denominator for a system-scoped category, the unit otherwise, nothing for faction", () => {
  it("developed_systems states its denominator", () => {
    expect(alertFooterText(populationCollapse)).toBe("2 of 253 developed systems");
  });

  it("controlled_systems states ITS OWN denominator, not the developed-systems one", () => {
    expect(alertFooterText(colonyOpportunity)).toBe("1 of 12 controlled systems");
  });

  it("faction returns null — a count that's always 1 by construction carries no information to state", () => {
    expect(alertFooterText(maintenanceUnfunded)).toBeNull();
  });
});

describe("AlertFlyout — renders every instance, no cap", () => {
  it("a category with far more instances than could ever fit on screen still renders all of them", async () => {
    // jsdom has no layout engine, so a scrollbar can't be asserted — the honest claim here is that
    // nothing truncates the list before it reaches the DOM. The scroll itself is a visual behaviour
    // (`overflow-y-auto` + a `max-height`) this test cannot see.
    const instances = manyInstances(40);
    const category: SystemScopedAlertCategory = { ...populationCollapse, count: 40, instances };
    await renderOpenFlyout(category);

    // The trigger button is a "button" too, hence 41 rather than 40.
    expect(screen.getAllByRole("button")).toHaveLength(41);
    expect(screen.getByText("System 39")).toBeInTheDocument();
  });
});

describe("AlertFlyout — Maintenance unfunded's single faction-level row", () => {
  it("renders the faction's name and measure, with no system name attached", async () => {
    await renderOpenFlyout(maintenanceUnfunded);

    const row = screen.getByRole("button", { name: /The Terran Compact/ });
    expect(row).toHaveTextContent("The Terran Compact");
    expect(row).toHaveTextContent("$1.2M short");
    // Exactly one row plus the trigger — the faction-level category's count is always 0 or 1 by
    // construction.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders no <footer> element at all — a stated '1 faction' count would carry no information", async () => {
    const { container } = render(
      <Popover>
        <PopoverTrigger>
          <button type="button">Open</button>
        </PopoverTrigger>
        <AlertFlyout category={maintenanceUnfunded} onNavigate={vi.fn()} />
      </Popover>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(container.querySelector("footer")).not.toBeInTheDocument();
  });
});

describe("AlertFlyout — row activation", () => {
  it("clicking a row navigates and leaves the flyout open, without removing the row", async () => {
    const onNavigate = vi.fn();
    const { user } = await renderOpenFlyout(populationCollapse, onNavigate);

    await user.click(screen.getByRole("button", { name: /Rigel/ }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "system", systemId: "sys-b", tab: "population" });
    // The row is still in the document: activating it applied no action against the category's own
    // data, did not remove itself from the list, and — since nothing in this component calls
    // anything that would close the popover — did not close it either.
    expect(screen.getByRole("button", { name: /Rigel/ })).toBeInTheDocument();
    // The trigger, plus Sunnyvale and Rigel's own rows.
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
