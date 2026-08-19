import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEvents } from "../use-events";
import { seedSlices } from "./store-fixture";
import type { ActiveEvent } from "@/lib/types/game";

/** Counts renders alongside the value under test — the vehicle for Proof 3 ("a hook re-renders on
 *  its slice's version and not on unrelated slices"). */
function RenderCounter({ renders }: { renders: { current: number } }) {
  const { events } = useEvents();
  renders.current += 1;
  return <p>events: {events.length}</p>;
}

function event(id: string): ActiveEvent {
  return {
    id,
    type: "refugee_crisis",
    name: "Refugee Crisis",
    description: "",
    phase: "onset",
    phaseDisplayName: "Onset",
    effects: "",
    systemId: null,
    systemName: null,
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: 10,
    ticksRemaining: 10,
    severity: 1,
  };
}

describe("useEvents — a store-backed component test, no QueryClientProvider", () => {
  it("renders the store's current events slice", () => {
    seedSlices({ events: [event("e1"), event("e2")] });
    const renders = { current: 0 };
    render(<RenderCounter renders={renders} />);
    expect(screen.getByText("events: 2")).toBeInTheDocument();
  });

  it("re-renders when its own slice's version changes, not when an unrelated slice does", () => {
    seedSlices({ events: [event("e1")] });
    const renders = { current: 0 };
    render(<RenderCounter renders={renders} />);
    const afterMount = renders.current;

    // An unrelated slice (visibility) changes at a newer version — useEvents must not re-render.
    seedSlices({ visibility: { systemIds: ["sys-x"] } });
    expect(renders.current).toBe(afterMount);

    // The events slice itself changes — useEvents must re-render with the new value.
    seedSlices({ events: [event("e1"), event("e2"), event("e3")] });
    expect(renders.current).toBe(afterMount + 1);
    expect(screen.getByText("events: 3")).toBeInTheDocument();
  });
});
