import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DWELL_MS, DWELL_OPEN_DELAY_MS, Popover, PopoverTrigger } from "@/components/ui/popover";
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
  LaneAlertInstance,
  LaneScopedAlertCategory,
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

function laneInstance(name: string, measure: string, laneKey: string, sortKey = 0): LaneAlertInstance {
  return { laneKey, name, measure, sortKey };
}

const laneCongested: LaneScopedAlertCategory = {
  id: "lane_congested",
  unit: "lanes",
  count: 1,
  denominator: 9,
  instances: [laneInstance("Sunnyvale — Rigel", "12.0 blocked", "sys-a|sys-b")],
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
    expect(resolveAlertTarget(populationCollapse, 0)).toEqual({
      kind: "system",
      systemId: "sys-a",
      tab: "population",
    });
  });

  it("Maintenance unfunded resolves to the player faction's Overview regardless of the instance's systemId", () => {
    expect(resolveAlertTarget(maintenanceUnfunded, 0)).toEqual({
      kind: "faction",
      tab: "",
    });
  });

  it("Lane congested resolves to the instance's own laneKey, not a system", () => {
    expect(resolveAlertTarget(laneCongested, 0)).toEqual({
      kind: "lane",
      laneKey: "sys-a|sys-b",
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

  it("lanes states its own denominator, not the developed-systems one", () => {
    expect(alertFooterText(laneCongested)).toBe("1 of 9 lanes");
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

  it("clicking a Lane congested row navigates with the instance's own laneKey", async () => {
    const onNavigate = vi.fn();
    const { user } = await renderOpenFlyout(laneCongested, onNavigate);

    await user.click(screen.getByRole("button", { name: /Sunnyvale — Rigel/ }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "lane", laneKey: "sys-a|sys-b" });
  });
});

describe("AlertFlyout — Lane congested's header term nests a dwell popover inside this click-opened flyout", () => {
  // The consumer-level pin of the fix in components/ui/popover.tsx: `scheduleLeaveClose` used to
  // close the whole stack (`closeFromDepth(-1)`) whenever the pointer left every `dwell` region,
  // with no regard for what sat below the dwell chain — and this flyout is exactly that shape, a
  // click-opened, non-`dwell` `Popover` whose header links a `TermLabel` (`components/ui/term-label
  // .tsx`, `dwell` mode) one level deeper. Real timers throughout, per this file's own dwell-mode
  // precedent (`components/ui/__tests__/popover.test.tsx`'s header comment) — Radix's Presence
  // machinery is fragile under fake timers, and a locked `dwell` popover still renders through it.
  it("opening the term and leaving it closes only the term, leaving the flyout open", async () => {
    const { user } = await renderOpenFlyout(laneCongested);
    const flyout = screen.getByRole("dialog", { name: "Lane congested alerts" });

    const term = screen.getByRole("button", { name: "Lane congested" });
    await user.hover(term);
    // Past the dwell open delay and the dwell-to-lock timer, so the term's own popover is `locked`
    // — real, fixed module constants (`DWELL_OPEN_DELAY_MS` 200, `DWELL_MS` 550), not a shortened
    // test double.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
    });
    const termCard = screen.getByRole("dialog", { name: "Congested" });
    expect(termCard).toBeInTheDocument();

    // Off the term entirely and onto the flyout's own body — its condition line, not the term's
    // trigger, not the term's own content, and not any other tracked dwell region — a genuine leave
    // of the whole dwell chain while the flyout itself is still very much under the pointer.
    await user.hover(screen.getByText(/turned hauls away at capacity/));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Congested" })).not.toBeInTheDocument();
    });
    // The bug this pins: the flyout used to close along with the term, via the leave grace's
    // close-everything sentinel having no notion of a non-`dwell` ancestor beneath the dwell chain.
    expect(flyout).toBeInTheDocument();
  });
});
