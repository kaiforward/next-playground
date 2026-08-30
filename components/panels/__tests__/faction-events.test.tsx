import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FactionEvents } from "@/components/panels/faction-events";
import type { ActiveEvent } from "@/lib/types/game";

const { eventsValue } = vi.hoisted(() => ({
  eventsValue: { current: [] as ActiveEvent[] },
}));

vi.mock("@/lib/hooks/use-events", () => ({
  useEvents: () => ({ events: eventsValue.current }),
}));

function makeEvent(overrides: Partial<ActiveEvent>): ActiveEvent {
  return {
    id: "e1",
    type: "border_conflict",
    name: "Border Conflict",
    description: "Skirmishes erupt along a contested faction border.",
    phase: "skirmish",
    phaseDisplayName: "Skirmish",
    effects: "Production slowed",
    systemId: "sys-1",
    systemName: "Alpha",
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: 30,
    ticksRemaining: 30,
    severity: 1,
    ...overrides,
  };
}

describe("FactionEvents — plain sortable list, no chips", () => {
  it("shows an empty state and no filter chips when there are no active events", () => {
    eventsValue.current = [];
    render(<FactionEvents />);

    expect(screen.getByText("No active events.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("lists active events with no severity sort option and no filter chips", () => {
    eventsValue.current = [
      makeEvent({ id: "e1", name: "Border Conflict", systemName: "Alpha", ticksRemaining: 30 }),
      makeEvent({ id: "e2", name: "Border Conflict", systemName: "Beta", ticksRemaining: 10 }),
    ];
    render(<FactionEvents />);

    expect(screen.getAllByText("Border Conflict")).toHaveLength(2);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    const sort = screen.getByRole("combobox", { name: "Sort by" });
    expect(sort).toHaveTextContent("Time remaining");
    expect(sort).toHaveTextContent("System name");
    expect(sort).not.toHaveTextContent("Severity");
  });

  it("defaults to Time remaining and reorders on both surviving sorts", async () => {
    const user = userEvent.setup();
    // Deliberately opposed orderings: soonest-expiring event is alphabetically last,
    // so the two sorts disagree and a passing test proves the sort actually ran.
    eventsValue.current = [
      makeEvent({ id: "far", systemName: "Alpha", ticksRemaining: 40 }),
      makeEvent({ id: "near", systemName: "Zeta", ticksRemaining: 5 }),
    ];
    render(<FactionEvents />);

    const rows = () => screen.getAllByText(/^(Alpha|Zeta)$/).map((el) => el.textContent);

    // Default sort is Time remaining — Zeta (5 ticks left) leads over Alpha (40).
    expect(rows()).toEqual(["Zeta", "Alpha"]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "system");
    expect(rows()).toEqual(["Alpha", "Zeta"]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "ticks");
    expect(rows()).toEqual(["Zeta", "Alpha"]);
  });

  it("shows the derived summary for a phase with real modifiers and the authored copy for one without", () => {
    eventsValue.current = [
      makeEvent({ id: "skirmish", phase: "skirmish", effects: "Production slowed" }),
      makeEvent({ id: "tension", phase: "tension", effects: "Forces massing at the border" }),
    ];
    render(<FactionEvents />);

    expect(screen.getByText("Production slowed")).toBeInTheDocument();
    expect(screen.getByText("Forces massing at the border")).toBeInTheDocument();
    expect(screen.queryByText("Minor market effects")).not.toBeInTheDocument();
  });
});
