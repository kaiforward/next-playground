import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertFlyout, resolveAlertTarget, alertFooterText } from "@/components/alerts/alert-flyout";
import type {
  AlertCategory,
  AlertInstance,
  ControlledSystemsAlertCategory,
  EventAlertCategory,
  FactionAlertCategory,
  SystemScopedAlertCategory,
} from "@/lib/types/api";

// AlertFlyout never fetches and never calls a router or the atlas itself — that lives in
// `ActiveAlertFlyout` (components/alerts/alert-run.tsx), which mounts only once a flyout is open
// and is exercised there, in alert-run.test.tsx's own "only one flyout open" case. Everything here
// renders AlertFlyout directly with spy props, per the same convention alert-chip.test.tsx and
// alert-run.test.tsx already use — accessible roles, names and rendered text, never a class or a
// style.

function instance(name: string, measure: string, systemId: string | null, sortKey = 0): AlertInstance {
  return { systemId, name, measure, sortKey };
}

const famine: SystemScopedAlertCategory = {
  id: "famine",
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

function crisisWith(instances: AlertInstance[]): EventAlertCategory {
  return { id: "crisis", unit: "events", count: instances.length, instances };
}

function manyInstances(n: number): AlertInstance[] {
  return Array.from({ length: n }, (_, i) => instance(`System ${i}`, `Provision ${i}%`, `sys-${i}`, i));
}

describe("resolveAlertTarget — the row's destination, resolved off the category and the instance", () => {
  it("a system-scoped category resolves to its authored tab, using the instance's own systemId", () => {
    expect(resolveAlertTarget(famine, famine.instances[0])).toEqual({
      kind: "system",
      systemId: "sys-a",
      tab: "population",
    });
  });

  it("Maintenance unfunded resolves to the faction route regardless of the instance's systemId", () => {
    expect(resolveAlertTarget(maintenanceUnfunded, maintenanceUnfunded.instances[0])).toEqual({
      kind: "route",
      path: "/factions",
    });
  });

  it("an event WITH a systemId resolves to that system's root (no authored tab)", () => {
    const withSystem = crisisWith([instance("Border skirmish", "3 ticks left", "sys-z")]);
    expect(resolveAlertTarget(withSystem, withSystem.instances[0])).toEqual({
      kind: "system",
      systemId: "sys-z",
      tab: "",
    });
  });

  it("an event with NO systemId resolves to the events route — no map focus attempted", () => {
    const regionLevel = crisisWith([instance("Alliance dissolved", "2 ticks left", null)]);
    expect(resolveAlertTarget(regionLevel, regionLevel.instances[0])).toEqual({
      kind: "route",
      path: "/events",
    });
  });
});

describe("alertFooterText — states the denominator for a system-scoped category, the unit otherwise, nothing for faction", () => {
  it("developed_systems states its denominator", () => {
    expect(alertFooterText(famine)).toBe("2 of 253 developed systems");
  });

  it("controlled_systems states ITS OWN denominator, not the developed-systems one", () => {
    expect(alertFooterText(colonyOpportunity)).toBe("1 of 12 controlled systems");
  });

  it("events states the unit, no denominator", () => {
    expect(alertFooterText(crisisWith(manyInstances(3)))).toBe("3 events");
  });

  it("faction returns null — a count that's always 1 by construction carries no information to state", () => {
    expect(alertFooterText(maintenanceUnfunded)).toBeNull();
  });
});

describe("AlertFlyout — renders every instance, no cap", () => {
  it("a category with far more instances than could ever fit on screen still renders all of them", () => {
    // jsdom has no layout engine, so a scrollbar can't be asserted — the honest claim here is that
    // nothing truncates the list before it reaches the DOM. The scroll itself is a visual behaviour
    // (`overflow-y-auto` + a `max-height`) this test cannot see.
    const instances = manyInstances(40);
    const category: SystemScopedAlertCategory = { ...famine, count: 40, instances };
    render(<AlertFlyout category={category} onNavigate={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getAllByRole("button")).toHaveLength(40);
    expect(screen.getByText("System 39")).toBeInTheDocument();
  });
});

describe("AlertFlyout — Maintenance unfunded's single faction-level row", () => {
  it("renders the faction's name and measure, with no system name attached", () => {
    render(<AlertFlyout category={maintenanceUnfunded} onNavigate={vi.fn()} onClose={vi.fn()} />);

    const row = screen.getByRole("button", { name: /The Terran Compact/ });
    expect(row).toHaveTextContent("The Terran Compact");
    expect(row).toHaveTextContent("$1.2M short");
    // Exactly one row — the faction-level category's count is always 0 or 1 by construction.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders no <footer> element at all — a stated '1 faction' count would carry no information", () => {
    const { container } = render(
      <AlertFlyout category={maintenanceUnfunded} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );

    expect(container.querySelector("footer")).not.toBeInTheDocument();
  });
});

describe("AlertFlyout — row activation", () => {
  it("clicking a row navigates and leaves the flyout open, without removing the row", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<AlertFlyout category={famine} onNavigate={onNavigate} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /Rigel/ }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "system", systemId: "sys-b", tab: "population" });
    // The flyout has exactly two ways to close — Escape, and a click outside it. A row is neither,
    // so a player can walk a category's instances one after another, which is the point of a list
    // with no cap.
    expect(onClose).not.toHaveBeenCalled();
    // The row is still in the document: activating it applied no action against the category's own
    // data and did not remove itself from the list.
    expect(screen.getByRole("button", { name: /Rigel/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("an event row with no systemId calls onNavigate with the events route, never a system target", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const regionLevel = crisisWith([instance("Alliance dissolved", "2 ticks left", null)]);
    render(<AlertFlyout category={regionLevel} onNavigate={onNavigate} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Alliance dissolved/ }));

    expect(onNavigate).toHaveBeenCalledWith({ kind: "route", path: "/events" });
  });
});

/** Mirrors how `AlertRun` actually mounts a flyout: a trigger button that opens it, `onClose`
 *  wired to a real state update so escaping actually unmounts `AlertFlyout` — the only way to
 *  observe its real focus-restore cleanup rather than a spy that never runs it. */
function Harness({ category }: { category: AlertCategory }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open {category.id}
      </button>
      {open && <AlertFlyout category={category} onNavigate={vi.fn()} onClose={() => setOpen(false)} />}
    </div>
  );
}

describe("AlertFlyout — Escape closes it and returns focus to its chip", () => {
  it("pressing Escape unmounts the flyout and returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<Harness category={famine} />);

    const trigger = screen.getByRole("button", { name: "Open famine" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Famine alerts" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Famine alerts" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
